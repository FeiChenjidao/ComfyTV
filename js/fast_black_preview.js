import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { createRenderer, makeMatte, replacementRGB, residualBlackWeight, allBlackWeight } from "./comfytv/fast_black_matte.js";

const NODE = "VideoBlackToAlphaVP8";
const DEFAULT_SIZE = [800, 740];
const RENDER_REVISION = "exterior-rgb-14-outside-in";
let backendRevision;
function checkBackend(){
  return backendRevision??=(async()=>{
    try{const response=await api.fetchApi("/comfytv/fast_black_render_info");return response.ok?(await response.json()).revision:"old";}
    catch{return "unavailable";}
  })();
}
const DEFAULTS = { black_threshold: 6, crf: 12, brightness: 0, contrast: 1, saturation: 1, hue: 0, gamma: 1, feather_shrink: 0, feather_softness: 0, preview_frame: 0 };
const RECOLOR_DEFAULTS = {recolor_enabled:false,replacement_color:"#ffffff",recolor_all_black:false};
const META = [
  ["black_threshold", "去黑阈值", 0, 254, 1], ["brightness", "亮度", -1, 1, .01],
  ["contrast", "对比度", 0, 3, .01], ["saturation", "饱和度", 0, 3, .01],
  ["hue", "色相", -180, 180, 1], ["gamma", "伽马", .1, 5, .01],
  ["feather_shrink", "外圈去黑边（像素）", 0, 200, 1], ["feather_softness", "外圈柔和（像素）", 0, 20, 1],
  ["preview_frame", "预览帧（0起）", 0, 999999, 1], ["crf", "CRF", 4, 63, 1],
];
const HELP = {
  black_threshold: "去黑阈值：决定哪些暗部变透明，作用于整个画面。\n数值越大，去掉的暗部越多；过高会丢失前景暗色细节。\n“改色”只修改去黑后仍可见的黑色；勾选“应用到全部黑色”后也会修改透明区域中的黑色 RGB。\n建议先调阈值，再用“外圈去黑边”清理剩余黑边。默认 6。",
  brightness: "亮度：整体提亮或压暗前景颜色。\n0 为原亮度；正数更亮，负数更暗。建议小幅调整。\n只改变颜色，不改变去黑判断和透明范围。",
  contrast: "对比度：调整前景明暗之间的差距。\n1 为原对比度；大于 1 明暗更强，小于 1 明暗更平缓。\n过高可能丢失亮部、暗部细节；不改变透明遮罩。",
  saturation: "饱和度：调整前景颜色的鲜艳程度。\n1 为原饱和度；大于 1 更鲜艳，0 为灰度。\n只改变颜色，不改变透明遮罩。",
  hue: "色相：旋转前景的颜色，单位为度。\n0 保持原色；正负数向不同方向改变颜色。\n仅想还原原图颜色时，通常保持 0；不改变透明遮罩。",
  gamma: "伽马：主要调整前景中间调和暗部的明亮程度。\n1 保持原效果；大于 1 提亮，小于 1 压暗。\n适合微调暗部细节；不改变透明遮罩。",
  feather_shrink: "外圈去黑边：按源图像像素距离清除外轮廓暗边，范围 0–200。\n无蒙版时只处理与外部相连的暗边；有蒙版时从外部透明背景向内清理未保护暗边，不从封闭暗区开洞。白色蒙版区始终保护。\n0 不额外清边；数值越大，清理范围越宽。建议从 1–3 开始；先用阈值让外部背景透明。",
  feather_softness: "外圈柔和：让外圈暗边的透明度过渡更柔和，范围 0–20 个源图像像素。\n0 不额外柔化；数值越大，过渡越宽、越柔和。建议从 1–2 开始。\n无蒙版时仅柔化外圈；有蒙版时柔化从外部向内清理后的暗边，白色蒙版区保护。",
  preview_frame: "预览帧：选择要查看的视频帧，从 0 开始，0 表示第一帧。\n只改变预览位置，不裁剪视频，也不改变完整导出的时长和帧率。\n图片输入时始终显示该图片，此参数不生效。",
  crf: "CRF：控制 VP8 完整导出的压缩质量，范围 4–63，默认 12。\n数值越低，画质越高、文件通常越大；数值越高，压缩越强。\n只影响导出文件，不影响浏览器即时预览。",
};
const getWidget = (node, name) => node.widgets?.find(w => w.name === name);
const num = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const executed = new Map();
api.addEventListener("executed", ({ detail }) => {
  if (detail?.node != null) executed.set(String(detail.node), detail.output);
});

function viewUrl(filename, subfolder = "", type = "input") {
  return "/view?" + new URLSearchParams({ filename, subfolder, type });
}

function mediaUrl(value, seen = new Set()) {
  if (!value) return "";
  if (typeof value === "string") {
    if (value.startsWith("/view?")) return value;
    if (value.startsWith("{")) {
      try { return mediaUrl(JSON.parse(value), seen); } catch { return ""; }
    }
    return "";
  }
  if (typeof value !== "object" || seen.has(value)) return "";
  seen.add(value);
  if (value.filename) return viewUrl(value.filename, value.subfolder || "", value.type || "output");
  for (const child of Object.values(value)) {
    const url = mediaUrl(child, seen);
    if (url) return url;
  }
  return "";
}

function linkedNode(node, slot) {
  const link = node.graph?.links?.get?.(slot.link) ?? node.graph?.links?.[slot.link];
  return link ? node.graph.getNodeById(link.origin_id) : null;
}

function nodeMedia(node, visited = new Set()) {
  if (!node || visited.has(node)) return "";
  visited.add(node);
  const output = mediaUrl(node.__comfytvStageApi?.state?.output)
    || mediaUrl(executed.get(String(node.id))) || mediaUrl(app.nodeOutputs?.[node.id])
    || mediaUrl(node.widgets_values_named?.asset_url) || mediaUrl(getWidget(node, "asset_url")?.value);
  if (output) return output;
  const filename = getWidget(node, "video")?.value || getWidget(node, "image")?.value
    || node.widgets_values_named?.video || node.widgets_values_named?.image;
  if (typeof filename === "string" && filename) {
    if (filename.startsWith("/view?")) return filename;
    if (/\.(mp4|webm|mov|mkv|avi|png|jpg|jpeg|webp)$/i.test(filename)) {
      const slash = filename.lastIndexOf("/");
      return viewUrl(filename.slice(slash + 1), slash < 0 ? "" : filename.slice(0, slash));
    }
  }
  const fromProperties = mediaUrl(node.properties?.comfytv_media);
  if (fromProperties) return fromProperties;
  // Bridge/reroute nodes can preview their source before they have been executed.
  for (const slot of node.inputs || []) {
    if (slot.link == null || !/IMAGE|VIDEO|\*/.test(slot.type || "")) continue;
    const url = nodeMedia(linkedNode(node, slot), visited);
    if (url) return url;
  }
  return "";
}

function resolveSource(node) {
  const slots = (node.inputs || []).filter(i => ["video", "image"].includes(i.name) && i.link != null);
  if (slots.length !== 1) return { error: slots.length ? "请只连接视频或图片中的一个输入" : "连接 ComfyTV 视频或图片后预览" };
  const url = nodeMedia(linkedNode(node, slots[0]));
  return url ? { url, kind: slots[0].name } : { error: "上游尚未提供媒体，请运行上游节点或重新选择文件" };
}
function resolveMask(node) {
  const slot=(node.inputs||[]).find(i=>i.name==="mask"&&i.link!=null);
  const maskSourceWidget=getWidget(node,"mask_image_url");
  if(maskSourceWidget)maskSourceWidget.value="";
  if(!slot)return "";
  const origin=linkedNode(node,slot),url=nodeMedia(origin);
  const type=String(origin?.comfyClass||origin?.type||"");
  if(url&&type==="ComfyTV.BridgeFromMask"){
    if(maskSourceWidget)maskSourceWidget.value=url;
    return "/comfytv/fast_black_mask_view?"+new URLSearchParams({source:url});
  }
  if(url&&type==="LoadImage")return "/comfytv/fast_black_mask_view?"+new URLSearchParams({source:url,mode:"alpha"});
  return url;
}

function drawCPU(ctx, pixels, p,protection=null) {
  const image = new ImageData(new Uint8ClampedArray(pixels.data),pixels.width,pixels.height);
  const d=image.data,co=Math.cos(p.hue*Math.PI/180),si=Math.sin(p.hue*Math.PI/180);
  const mask=makeMatte(pixels,p,protection);
  const baseMask=protection?makeMatte(pixels,p,{...protection,data:new Uint8ClampedArray(protection.data.length)}):mask;
  const target=p.recolor_enabled?replacementRGB(p.replacement_color):null;
  for(let i=0;i<d.length;i+=4){
    const alpha=mask[i/4]/255;
    const protectedValue=protection?protection.data[i]/255:0;
    const strength=(target&&(p.recolor_all_black||baseMask[i/4]>0)?(p.recolor_all_black?allBlackWeight(pixels.data[i],pixels.data[i+1],pixels.data[i+2]):residualBlackWeight(pixels.data[i],pixels.data[i+1],pixels.data[i+2])):0)*(1-protectedValue);
    let r=(d[i]/255-.5)*p.contrast+.5+p.brightness,g=(d[i+1]/255-.5)*p.contrast+.5+p.brightness,b=(d[i+2]/255-.5)*p.contrast+.5+p.brightness;
    const y=.299*r+.587*g+.114*b;r=y+(r-y)*p.saturation;g=y+(g-y)*p.saturation;b=y+(b-y)*p.saturation;
    const c=[(.213+.787*co-.213*si)*r+(.715-.715*co-.715*si)*g+(.072-.072*co+.928*si)*b,
      (.213-.213*co+.143*si)*r+(.715+.285*co+.140*si)*g+(.072-.072*co-.283*si)*b,
      (.213-.213*co-.787*si)*r+(.715-.715*co+.715*si)*g+(.072+.928*co+.072*si)*b];
    c.forEach((v,j)=>{
      const value=255*Math.max(0,Math.min(1,Math.pow(Math.max(0,v),1/p.gamma)));
      d[i+j]=target?Math.floor(Math.floor(value+.5)*(1-strength)+target[j]*strength+.5):value;
    });d[i+3]=255*alpha;
  }
  ctx.putImageData(image,0,0);
}

function buildPanel(node) {
  const root=document.createElement("div");root.className="fast-black-panel";
  root.style.cssText="display:flex;flex-direction:column;gap:8px;padding:8px;background:#202025;border-radius:10px;color:#ddd;font:12px system-ui,sans-serif;box-sizing:border-box;pointer-events:auto;user-select:none;";
  // LiteGraph can otherwise treat a drag on an embedded DOM widget as node movement.
  for(const event of ["pointerdown","pointermove","pointerup","mousedown","mousemove","mouseup","wheel","click"]){
    root.addEventListener(event,e=>e.stopPropagation(),{passive:event==="wheel"});
  }
  const viewport=document.createElement("div");
  viewport.style.cssText="position:relative;border-radius:8px;overflow:hidden;background-size:20px 20px;";
  let canvas=document.createElement("canvas");canvas.style.cssText="width:100%;height:270px;display:block;object-fit:contain;background:transparent;";viewport.append(canvas);root.append(viewport);
  const backgroundToggle=document.createElement("button");backgroundToggle.type="button";backgroundToggle.setAttribute("aria-label","亮色棋盘格");
  backgroundToggle.style.cssText="position:absolute;top:8px;right:8px;z-index:1;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:5px;border:1px solid #777;border-radius:6px;cursor:pointer;box-shadow:0 1px 4px #0004;";
  backgroundToggle.innerHTML='<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><rect x="1" y="1" width="14" height="14" rx="1" fill="none" stroke="currentColor"/><path d="M1 1h7v7H1zM8 8h7v7H8z" fill="currentColor"/></svg>';
  viewport.append(backgroundToggle);
  function applyBackground(){
    const light=node.properties?.fastBlackPreviewBackground==="light";
    viewport.style.backgroundColor=light?"#f2f2f2":"#25252b";
    const tile=light?"#d2d2d2":"#35353e";
    viewport.style.backgroundImage=`conic-gradient(${tile} 25%,transparent 0 50%,${tile} 0 75%,transparent 0)`;
    backgroundToggle.style.background=light?"#fffffff0":"#25252bf0";backgroundToggle.style.color=light?"#333":"#eee";
    backgroundToggle.setAttribute("aria-pressed",String(light));
    backgroundToggle.title=light?"切换为深色棋盘格（仅预览背景）":"切换为亮色棋盘格（仅预览背景）";
  }
  backgroundToggle.onclick=()=>{
    node.properties.fastBlackPreviewBackground=node.properties.fastBlackPreviewBackground==="light"?"dark":"light";
    applyBackground();node.graph?.setDirtyCanvas?.(true,true);
  };
  applyBackground();
  const status=document.createElement("div");status.style.cssText="color:#aaa;min-height:16px;text-align:center;";root.append(status);
  let renderer=null,ctx=null;
  try{renderer=createRenderer(canvas);}catch(error){console.warn("[快速去黑] WebGL 初始化失败，使用 Canvas",error);}
  if(!renderer){const replacement=canvas.cloneNode();canvas.replaceWith(replacement);canvas=replacement;ctx=canvas.getContext("2d",{willReadFrequently:true});}
  root.dataset.renderer=renderer?"webgl2":"canvas2d";
  const grid=document.createElement("div");grid.style.cssText="display:grid;grid-template-columns:1fr 1fr;gap:6px 10px;";root.append(grid);
  const fields=new Map();let sourceKey="",media=null,maskMedia=null,disposed=false,generation=0,raf=0,textureDirty=true,maskDirty=true,pixels=null;
  let info={fps:24,frames:1,width:0,height:0};
  const params=()=>({...Object.fromEntries(Object.entries(DEFAULTS).map(([name,value])=>[name,num(getWidget(node,name)?.value,value)])),
    recolor_enabled:getWidget(node,"recolor_enabled")?.value===true,
    replacement_color:getWidget(node,"replacement_color")?.value??RECOLOR_DEFAULTS.replacement_color,
    recolor_all_black:getWidget(node,"recolor_all_black")?.value===true});
  const schedule=()=>{if(!raf&&!disposed)raf=requestAnimationFrame(()=>{raf=0;render();});};
  function seek(){if(media instanceof HTMLVideoElement&&media.readyState>=2){media.currentTime=Math.min(params().preview_frame,info.frames-1)/info.fps;}}
  for(const [name,label,min,max,step] of META){
    const row=document.createElement("label");row.dataset.param=name;row.style.cssText="display:grid;grid-template-columns:auto minmax(30px,1fr) 48px;align-items:center;gap:5px;";
    row.title=HELP[name];
    const text=document.createElement("span");text.textContent=label;text.title=HELP[name];
    text.style.cssText="cursor:help;";
    const slider=document.createElement("input");slider.type="range";const number=document.createElement("input");number.type="number";
    slider.style.pointerEvents="auto";number.style.pointerEvents="auto";
    for(const control of [slider,number]){control.min=min;control.max=max;control.step=step;}
    number.style.cssText="width:48px;background:#303038;color:#eee;border:1px solid #555;border-radius:4px;box-sizing:border-box;";
    const sync=()=>{
      const w=getWidget(node,name);
      slider.disabled=number.disabled=false;row.style.opacity="1";
      row.title=text.title=HELP[name];
      slider.value=number.value=num(getWidget(node,name)?.value,DEFAULTS[name]);
    };
    const set=value=>{const n=Math.max(min,Math.min(num(number.max,max),num(value,DEFAULTS[name])));const w=getWidget(node,name);if(w)w.value=n;sync();if(name==="preview_frame")seek();else schedule();node.graph?.setDirtyCanvas?.(true,true);};
    slider.oninput=()=>set(slider.value);number.oninput=()=>set(number.value);row.append(text,slider,number);grid.append(row);fields.set(name,{sync,set,slider,number});sync();
  }
  const recolorRow=document.createElement("div");recolorRow.style.cssText="display:flex;align-items:center;flex-wrap:wrap;gap:8px;min-height:28px;";root.append(recolorRow);
  const recolorLabel=document.createElement("label");recolorLabel.style.cssText="display:inline-flex;align-items:center;gap:5px;cursor:pointer;";
  recolorLabel.title="只修改去黑后仍可见的黑色、近黑色边缘，透明区域继续透明，亮色和彩色细节保留；改色会写入导出文件。";
  const recolorCheck=document.createElement("input");recolorCheck.type="checkbox";recolorLabel.append(recolorCheck,document.createTextNode("改色"));recolorRow.append(recolorLabel);
  const allBlackLabel=document.createElement("label");allBlackLabel.style.cssText="display:inline-flex;align-items:center;gap:5px;cursor:pointer;";
  allBlackLabel.title="按视觉明暗修改全部黑色、近黑色（包含深紫、深红暗边）；蒙版白色区域不改色，灰色按比例生效。保持原透明度。可能影响未保护的前景深色细节。";
  const allBlackCheck=document.createElement("input");allBlackCheck.type="checkbox";allBlackCheck.setAttribute("aria-label","应用到全部黑色");allBlackLabel.append(allBlackCheck,document.createTextNode("应用到全部黑色"));recolorRow.append(allBlackLabel);
  const colorControls=document.createElement("div");colorControls.style.cssText="display:flex;align-items:center;gap:8px;flex-wrap:wrap;";recolorRow.append(colorControls);
  const colorInput=document.createElement("input");colorInput.type="color";colorInput.title="选择去黑后残留黑色要改成的颜色";colorInput.setAttribute("aria-label","改色颜色");
  colorInput.style.cssText="width:34px;height:26px;padding:1px;border:1px solid #555;border-radius:4px;background:#303038;cursor:pointer;";
  const colorHex=document.createElement("input");colorHex.type="text";colorHex.maxLength=7;colorHex.setAttribute("aria-label","改色颜色 HEX");colorHex.title="输入 #RRGGBB，例如 #ff8800";
  colorHex.style.cssText="width:78px;background:#303038;color:#eee;border:1px solid #555;border-radius:4px;padding:3px;";
  const pickColor=document.createElement("button");pickColor.type="button";pickColor.textContent="吸色";
  pickColor.title="吸取屏幕颜色；浏览器不支持时，点击预览画面吸色。Esc 取消。";
  pickColor.style.cssText="padding:3px 8px;border:1px solid #555;border-radius:4px;background:#303038;color:#ddd;cursor:pointer;";
  const colorHint=document.createElement("span");colorHint.style.cssText="font-size:11px;color:#aaa;";
  colorControls.append(colorInput,colorHex,pickColor,colorHint);
  let picking=false,pickController=null;
  function cancelPicking(){
    picking=false;canvas.style.cursor="";pickController?.abort();pickController=null;colorHint.textContent="";
  }
  function syncRecolor(){
    const enabledWidget=getWidget(node,"recolor_enabled"),colorWidget=getWidget(node,"replacement_color");
    const allBlackWidget=getWidget(node,"recolor_all_black");
    // Older workflows can have an empty DOM-widget value at the new input positions.
    if(enabledWidget&&typeof enabledWidget.value!=="boolean")enabledWidget.value=false;
    if(colorWidget&&!/^#[\da-f]{6}$/i.test(colorWidget.value))colorWidget.value=RECOLOR_DEFAULTS.replacement_color;
    const p=params();recolorCheck.checked=p.recolor_enabled;
    allBlackCheck.checked=p.recolor_all_black;allBlackCheck.disabled=!p.recolor_enabled||!allBlackWidget;
    recolorCheck.disabled=!enabledWidget||!colorWidget;
    if(recolorCheck.disabled)recolorLabel.title="请先重启 ComfyUI 后端，再刷新页面，加载新增的改色参数。";
    colorControls.style.display=p.recolor_enabled?"flex":"none";
    allBlackLabel.style.display=p.recolor_enabled?"inline-flex":"none";
    colorInput.value=colorHex.value=p.replacement_color;
    if(!p.recolor_enabled)cancelPicking();
  }
  function setColor(value){
    if(!/^#[\da-f]{6}$/i.test(value))return;
    const w=getWidget(node,"replacement_color");if(!w)return;
    w.value=value.toLowerCase();cancelPicking();syncRecolor();schedule();node.graph?.setDirtyCanvas?.(true,true);
  }
  recolorCheck.onchange=()=>{
    const w=getWidget(node,"recolor_enabled");if(w)w.value=recolorCheck.checked;
    syncRecolor();schedule();node.graph?.setDirtyCanvas?.(true,true);
  };
  allBlackCheck.onchange=()=>{const w=getWidget(node,"recolor_all_black");if(w)w.value=allBlackCheck.checked;schedule();node.graph?.setDirtyCanvas?.(true,true);};
  colorInput.oninput=()=>setColor(colorInput.value);colorHex.oninput=()=>setColor(colorHex.value);colorHex.onblur=syncRecolor;
  function pickFromPreview(){picking=true;canvas.style.cursor="crosshair";colorHint.textContent="点击预览画面吸色，Esc 取消";pickColor.focus();}
  pickColor.onclick=async()=>{
    if(picking||pickController){cancelPicking();return;}
    if(!window.EyeDropper){pickFromPreview();return;}
    const controller=new AbortController();pickController=controller;
    try{const result=await new window.EyeDropper().open({signal:controller.signal});if(!disposed&&!controller.signal.aborted)setColor(result.sRGBHex);}
    catch(error){if(!disposed&&error.name!=="AbortError")pickFromPreview();}
    finally{if(pickController===controller)pickController=null;}
  };
  canvas.addEventListener("click",event=>{
    if(!picking||!media||!info.width)return;
    const rect=canvas.getBoundingClientRect(),scale=Math.min(rect.width/canvas.width,rect.height/canvas.height);
    const x=Math.floor((event.clientX-rect.left-(rect.width-canvas.width*scale)/2)/scale);
    const y=Math.floor((event.clientY-rect.top-(rect.height-canvas.height*scale)/2)/scale);
    if(x<0||y<0||x>=canvas.width||y>=canvas.height)return;
    try{
      render();
      const sample=document.createElement("canvas");sample.width=sample.height=1;
      const sampleCtx=sample.getContext("2d");sampleCtx.drawImage(canvas,x,y,1,1,0,0,1,1);
      const rgb=sampleCtx.getImageData(0,0,1,1).data;
      if(!rgb[3]){colorHint.textContent="请点击有颜色的画面区域";return;}
      setColor("#"+Array.from(rgb.subarray(0,3),v=>v.toString(16).padStart(2,"0")).join(""));
    }catch{colorHint.textContent="吸色失败，请用颜色选择器选择";}
  });
  root.addEventListener("keydown",event=>{if(event.key==="Escape")cancelPicking();});
  syncRecolor();
  const footer=document.createElement("div");footer.style.cssText="display:flex;align-items:center;gap:8px;margin-top:auto;padding-top:4px;";root.append(footer);
  const reset=document.createElement("button");reset.type="button";reset.title="一键还原参数";reset.setAttribute("aria-label","一键还原参数");
  reset.style.cssText="display:inline-flex;align-items:center;justify-content:center;flex:0 0 28px;width:28px;height:28px;padding:5px;border:1px solid #555;border-radius:6px;background:#303038;color:#ddd;cursor:pointer;";
  reset.innerHTML='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11a9 9 0 1 1 2.6 7.4"/><path d="M3 4v7h7"/></svg>';
  reset.onclick=()=>{
    for(const [name,value]of Object.entries(DEFAULTS))fields.get(name).set(value);
    for(const [name,value]of Object.entries(RECOLOR_DEFAULTS)){const w=getWidget(node,name);if(w)w.value=value;}
    syncRecolor();schedule();
  };footer.append(reset);
  const hint=document.createElement("span");hint.textContent="拖动即时预览；点击节点 ▶ 完整导出";footer.append(hint);
  checkBackend().then(revision=>{
    if(disposed)return;
    if(revision!==RENDER_REVISION){
      hint.style.color="#ffbd78";
      hint.textContent=revision==="unavailable"?"无法核对后端版本，请检查连接后刷新页面。":"后端仍是旧版，导出与预览算法不同：请完全重启 ComfyUI，再按 Ctrl+F5 刷新。";
    }
  });
  function render(){
    if(disposed||!media||!info.width||(media instanceof HTMLVideoElement&&media.readyState<2))return;
    try{
      const w=info.width,h=info.height;
      if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;textureDirty=true;}
      if(renderer)renderer.draw(media,params(),textureDirty,maskMedia,maskDirty);
      else{
        if(textureDirty||!pixels){ctx.clearRect(0,0,w,h);ctx.drawImage(media,0,0,w,h);pixels=ctx.getImageData(0,0,w,h);}
        let protection=null;
        if(maskMedia){const c=document.createElement("canvas");c.width=w;c.height=h;const context=c.getContext("2d");context.drawImage(maskMedia,0,0,w,h);protection=context.getImageData(0,0,w,h);}
        drawCPU(ctx,pixels,params(),protection);
      }
      textureDirty=false;maskDirty=false;root.dataset.renderCount=String(num(root.dataset.renderCount)+1);status.textContent="";
    }catch(error){status.textContent=`预览渲染失败：${error.message}`;console.error(error);}
  }
  async function load(){
    if(disposed)return;
    for(const name of ["feather_shrink","feather_softness"])fields.get(name)?.sync();
    const source=resolveSource(node),maskUrl=resolveMask(node),key=source.url?`${source.kind}:${source.url}|mask:${maskUrl}`:"";
    if(!key){status.textContent=source.error;sourceKey="";return;}
    if(key===sourceKey)return;cancelPicking();sourceKey=key;const token=++generation;
    if(media instanceof HTMLVideoElement){media.pause();media.removeAttribute("src");media.load();}
    const current=source.kind==="video"?document.createElement("video"):new Image();media=current;maskMedia=null;maskDirty=true;pixels=null;info={fps:24,frames:1,width:0,height:0};
    status.textContent="正在加载媒体…";current.crossOrigin="anonymous";
    current.onerror=()=>{if(token===generation)status.textContent=`媒体加载失败：${source.url}`;};
    if(maskUrl){
      const maskImage=new Image();maskImage.crossOrigin="anonymous";maskImage.onload=()=>{if(token!==generation)return;maskMedia=maskImage;maskDirty=true;schedule();};maskImage.onerror=()=>{if(token===generation)status.textContent="遮罩蒙版加载失败，已按无蒙版预览";};maskImage.src=api.apiURL(maskUrl);
    }
    if(current instanceof HTMLVideoElement){
      current.muted=true;current.preload="auto";current.playsInline=true;
      current.onloadeddata=()=>{if(token!==generation)return;info.width=current.videoWidth;info.height=current.videoHeight;textureDirty=true;schedule();};
      current.onseeked=()=>{if(token!==generation)return;textureDirty=true;schedule();};
      current.onloadedmetadata=async()=>{
        try{const response=await api.fetchApi("/comfytv/fast_black_media_info",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({source:source.url})});if(!response.ok)throw new Error("元数据读取失败");const data=await response.json();if(token!==generation)return;info.fps=num(data.fps,24);info.frames=num(data.frames,1);}catch(error){if(token!==generation)return;info.frames=Math.max(1,Math.round(current.duration*info.fps));console.warn(error);}
        fields.get("preview_frame").slider.max=fields.get("preview_frame").number.max=info.frames-1;seek();
      };
    }else current.onload=()=>{if(token!==generation)return;info.width=current.naturalWidth;info.height=current.naturalHeight;textureDirty=true;schedule();};
    current.src=api.apiURL(source.url);if(current instanceof HTMLVideoElement)current.load();
  }
  root.load=load;
  root.sync=()=>{applyBackground();syncRecolor();for(const field of fields.values())field.sync();load();schedule();};
  const poll=setInterval(()=>load(),500);
  root.dispose=()=>{disposed=true;cancelPicking();generation++;clearInterval(poll);cancelAnimationFrame(raf);if(media instanceof HTMLVideoElement){media.pause();media.removeAttribute("src");media.load();}renderer?.dispose();};
  queueMicrotask(load);return root;
}

app.registerExtension({
  name:"ComfyTV.FastBlackPreview",
  nodeCreated(node){
    if(String(node.comfyClass||node.type)!==NODE||node.__fastBlack)return;
    // The previous controls were intensity offsets (0..255), not pixel radii.
    node.properties??={};
    const migrate=()=>{
      if(node.properties.fastBlackMatteVersion!==2){
        for(const name of ["feather_shrink","feather_softness"]){const w=getWidget(node,name);if(w)w.value=0;}
        node.properties.fastBlackMatteVersion=2;
      }
    };
    migrate();
    let restored=false;
    const panel=buildPanel(node);node.__fastBlack=panel;
    node.addDOMWidget("fast_black_panel","fast_black_panel",panel,{getMinHeight:()=>restored?460:600,hideOnZoom:false,serialize:false});
  for(const w of node.widgets||[])if(["filename_prefix","edge_threshold","mask_image_url",...Object.keys(DEFAULTS),...Object.keys(RECOLOR_DEFAULTS)].includes(w.name)){w.computeSize=()=>[0,-4];w.type="hidden";}
    const connections=node.onConnectionsChange;node.onConnectionsChange=function(...args){connections?.apply(this,args);panel.load();};
    const configured=node.onConfigure;node.onConfigure=function(...args){
      restored=true;
      configured?.apply(this,args);
      if(args[0]?.properties?.fastBlackMatteVersion!==2)node.properties.fastBlackMatteVersion=1;
      queueMicrotask(()=>{migrate();panel.sync();});
    };
    const removed=node.onRemoved;node.onRemoved=function(...args){panel.dispose();removed?.apply(this,args);};
    queueMicrotask(()=>{if(!restored){node.setSize([...DEFAULT_SIZE]);node.graph?.setDirtyCanvas?.(true,true);}});
  },
});
