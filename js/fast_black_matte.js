// Connectivity uses four neighbours; distances use source-pixel chessboard distance.
const topologyCache = new WeakMap();
export function exteriorDistances(pixels, threshold, allRegions=false,edgeThreshold=96) {
  const cached = topologyCache.get(pixels);
  if (cached?.threshold === threshold&&cached.allRegions===allRegions&&cached.edgeThreshold===edgeThreshold) return cached.distance;
  const {width:w,height:h,data} = pixels, n=w*h;
  const background=new Uint8Array(n),dark=new Uint8Array(n),outside=new Uint8Array(n);
  const queue=new Int32Array(n);let head=0,tail=0;
  for(let i=0;i<n;i++){
    const high=Math.max(data[i*4],data[i*4+1],data[i*4+2]);
    const low=Math.min(data[i*4],data[i*4+1],data[i*4+2]);
        background[i]=high<=threshold?1:0;
    if(allRegions){
      const r=data[i*4],g=data[i*4+1],b=data[i*4+2];
      const greenLeaf=high-low>20&&g>r*1.1&&g>b*.8;
      dark[i]=.299*r+.587*g+.114*b<=edgeThreshold&&!greenLeaf?1:0;
    }else dark[i]=high<=64&&high-low<=20?1:0;
  }
  function seed(i){if(background[i]&&!outside[i]){outside[i]=1;queue[tail++]=i;}}
  for(let x=0;x<w;x++){seed(x);seed((h-1)*w+x);}
  for(let y=0;y<h;y++){seed(y*w);seed(y*w+w-1);}
  function flood(visited,allowDark){
    function visit(i){
      if(!visited[i]&&(background[i]||(allowDark&&dark[i]))){visited[i]=1;queue[tail++]=i;}
    }
    while(head<tail){
      const i=queue[head++],x=i%w;
      if(x)visit(i-1);if(x+1<w)visit(i+1);if(i>=w)visit(i-w);if(i+w<n)visit(i+w);
    }
  }
  flood(outside,false);
  const distance=new Uint8Array(n);distance.fill(255);
  if(!tail){topologyCache.set(pixels,{threshold,allRegions,distance});return distance;}
  const connected=outside.slice();head=0;flood(connected,true);
  for(let i=0;i<n;i++)if(outside[i])distance[i]=0;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=y*w+x;let d=distance[i];
    if(x)d=Math.min(d,distance[i-1]+1);
    if(y){d=Math.min(d,distance[i-w]+1);if(x)d=Math.min(d,distance[i-w-1]+1);if(x+1<w)d=Math.min(d,distance[i-w+1]+1);}
    distance[i]=d;
  }
  for(let y=h-1;y>=0;y--)for(let x=w-1;x>=0;x--){
    const i=y*w+x;let d=distance[i];
    if(x+1<w)d=Math.min(d,distance[i+1]+1);
    if(y+1<h){d=Math.min(d,distance[i+w]+1);if(x)d=Math.min(d,distance[i+w-1]+1);if(x+1<w)d=Math.min(d,distance[i+w+1]+1);}
    distance[i]=d;
  }
  for(let i=0;i<n;i++)if(!connected[i]||!dark[i])distance[i]=255;
  topologyCache.set(pixels,{threshold,allRegions,distance});return distance;
}

const matteCache=new WeakMap();
export function replacementRGB(value="#ffffff"){
  if(!/^#[\da-f]{6}$/i.test(value))throw Error("改色颜色需为 #RRGGBB 格式");
  return [1,3,5].map(i=>parseInt(value.slice(i,i+2),16));
}
export function residualBlackWeight(r,g,b){
  const high=Math.max(r,g,b),chroma=high-Math.min(r,g,b);
  const dark=Math.max(0,Math.min(1,(high-32)/64));
  const neutral=Math.max(0,Math.min(1,(chroma-12)/28));
  return (1-dark*dark*(3-2*dark))*(1-neutral*neutral*(3-2*neutral));
}
export function allBlackWeight(r,g,b){
  const luminance=.299*r+.587*g+.114*b,t=Math.max(0,Math.min(1,(luminance-64)/64));
  return 1-t*t*(3-2*t);
}
export function makeMatte(pixels,p,protection=null){
  const shrink=Math.max(0,Math.min(200,Math.round(p.feather_shrink)));
  const soft=Math.max(0,Math.min(20,Math.round(p.feather_softness)));
  const key=[p.black_threshold,shrink,soft,p.edge_threshold??96].join(":");
  const cached=matteCache.get(pixels);if(cached?.key===key&&cached.protection===protection)return cached.mask;
  const n=pixels.width*pixels.height,mask=new Uint8Array(n),data=pixels.data;
  const edgeLimit=protection?Math.min(160,(p.edge_threshold??96)+Math.floor(shrink/2)):(p.edge_threshold??96);
  const distance=shrink||soft?exteriorDistances(pixels,p.black_threshold,!!protection,edgeLimit):null;
  for(let i=0;i<n;i++){
    let alpha=Math.floor(Math.max(0,Math.min(255,(Math.max(data[i*4],data[i*4+1],data[i*4+2])-p.black_threshold)*255/34)));
    if(distance){
      const t=soft?Math.max(0,Math.min(1,(distance[i]-shrink)/(soft+1))):(distance[i]>shrink?1:0);
      alpha=Math.floor(alpha*t*t*(3-2*t)+.5);
    }
    mask[i]=alpha;
    if(protection)mask[i]=Math.max(mask[i],protection.data[i*4]);
  }
  matteCache.set(pixels,{key,protection,mask});return mask;
}

export function createRenderer(canvas, force2d=false){
  const gl=force2d?null:canvas.getContext("webgl2",{premultipliedAlpha:false,antialias:false});
  if(!gl)return null;
  const sources=[
    [gl.VERTEX_SHADER,`#version 300 es
      in vec2 p;out vec2 uv;
      void main(){uv=(p+1.)*.5;gl_Position=vec4(p,0.,1.);}`],
    [gl.FRAGMENT_SHADER,`#version 300 es
      precision highp float;
      uniform sampler2D tex,edgeDistance,protectionMask;
      uniform float threshold,shrink,softness,brightness,contrast,saturation,hue,gammaValue;
      uniform bool recolorEnabled,recolorAllBlack,hasProtectionMask;
      uniform vec3 replacementColor;
      in vec2 uv;out vec4 outColor;
      void main(){
        vec2 coord=vec2(uv.x,1.-uv.y);vec4 q=texture(tex,coord);
        vec3 bytes=floor(q.rgb*255.+.5);
        float alpha=floor(clamp((max(bytes.r,max(bytes.g,bytes.b))-threshold)*255./34.,0.,255.)+.0001);
        float protectionValue=hasProtectionMask?texture(protectionMask,coord).r:0.;
        if(shrink>0.||softness>0.){
          float d=floor(texture(edgeDistance,coord).r*255.+.5);
          float t=softness>0.?clamp((d-shrink)/(softness+1.),0.,1.):(d>shrink?1.:0.);
          alpha=floor(alpha*t*t*(3.-2.*t)+.50001);
        }
        float baseAlpha=alpha;
        alpha=max(alpha,floor(protectionValue*255.+.5));
        vec3 c=(q.rgb-.5)*contrast+.5+brightness;
        float gray=dot(c,vec3(.299,.587,.114));c=mix(vec3(gray),c,saturation);
        float co=cos(radians(hue)),si=sin(radians(hue));
        c=vec3(dot(c,vec3(.213+.787*co-.213*si,.715-.715*co-.715*si,.072-.072*co+.928*si)),
               dot(c,vec3(.213-.213*co+.143*si,.715+.285*co+.140*si,.072-.072*co-.283*si)),
               dot(c,vec3(.213-.213*co-.787*si,.715-.715*co+.715*si,.072+.928*co+.072*si)));
        c=clamp(pow(max(c,vec3(0.)),vec3(1./gammaValue)),0.,1.);
        if(recolorEnabled&&(recolorAllBlack||baseAlpha>0.)){
          c=floor(c*255.+.5);
          float high=max(bytes.r,max(bytes.g,bytes.b));
          float chroma=high-min(bytes.r,min(bytes.g,bytes.b));
          float strength=recolorAllBlack?(1.-smoothstep(64.,128.,dot(bytes,vec3(.299,.587,.114)))):(1.-smoothstep(32.,96.,high))*(1.-smoothstep(12.,40.,chroma));
        strength*=1.-protectionValue;
          c=floor(mix(c,replacementColor,strength)+.5)/255.;
        }
        outColor=vec4(c,alpha/255.);
      }`]
  ];
  const program=gl.createProgram();
  for(const [type,text]of sources){
    const shader=gl.createShader(type);gl.shaderSource(shader,text);gl.compileShader(shader);
    if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader));
    gl.attachShader(program,shader);gl.deleteShader(shader);
  }
  gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
  const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
  const position=gl.getAttribLocation(program,"p");
  const texture=gl.createTexture(),distanceTexture=gl.createTexture(),protectionTexture=gl.createTexture();
  for(const t of [texture,distanceTexture,protectionTexture]){
    gl.bindTexture(gl.TEXTURE_2D,t);
    for(const [key,value]of [[gl.TEXTURE_MIN_FILTER,gl.NEAREST],[gl.TEXTURE_MAG_FILTER,gl.NEAREST],[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE]])gl.texParameteri(gl.TEXTURE_2D,key,value);
  }
  gl.bindTexture(gl.TEXTURE_2D,distanceTexture);gl.texImage2D(gl.TEXTURE_2D,0,gl.R8,1,1,0,gl.RED,gl.UNSIGNED_BYTE,new Uint8Array([255]));
  gl.bindTexture(gl.TEXTURE_2D,protectionTexture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([0,0,0,255]));
  const uniforms=Object.fromEntries(["tex","edgeDistance","protectionMask","threshold","shrink","softness","brightness","contrast","saturation","hue","gammaValue","recolorEnabled","recolorAllBlack","hasProtectionMask","replacementColor"].map(n=>[n,gl.getUniformLocation(program,n)]));
  const analysis=document.createElement("canvas"),ctx=analysis.getContext("2d",{willReadFrequently:true});
  let pixels=null,lastThreshold=null,lastMaskMode=null,lastEdgeThreshold=null;
  return {
    draw(media,p,upload,mask,maskUpload){
      gl.viewport(0,0,canvas.width,canvas.height);gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);
      if(upload){
        // Use the same 8-bit browser RGB for color and connectivity analysis.
        analysis.width=canvas.width;analysis.height=canvas.height;ctx.drawImage(media,0,0);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,analysis);pixels=null;lastThreshold=null;
      }
      gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,distanceTexture);
      const edgeLimit=mask?Math.min(160,(p.edge_threshold??96)+Math.floor(Math.max(0,Math.min(200,p.feather_shrink))/2)):(p.edge_threshold??96);
      if((p.feather_shrink||p.feather_softness)&&(lastThreshold!==p.black_threshold||lastMaskMode!==!!mask||lastEdgeThreshold!==edgeLimit)){
        if(!pixels)pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
        const distance=exteriorDistances(pixels,p.black_threshold,!!mask,edgeLimit);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.R8,canvas.width,canvas.height,0,gl.RED,gl.UNSIGNED_BYTE,distance);
        lastThreshold=p.black_threshold;
        lastMaskMode=!!mask;
        lastEdgeThreshold=edgeLimit;
      }
      gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,protectionTexture);
      if(mask&&maskUpload)gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,mask);
      gl.uniform1i(uniforms.tex,0);gl.uniform1i(uniforms.edgeDistance,1);gl.uniform1i(uniforms.protectionMask,2);gl.uniform1i(uniforms.hasProtectionMask,mask?1:0);
      gl.uniform1f(uniforms.threshold,p.black_threshold);gl.uniform1f(uniforms.shrink,Math.max(0,Math.min(200,Math.round(p.feather_shrink))));
      gl.uniform1f(uniforms.softness,Math.max(0,Math.min(20,Math.round(p.feather_softness))));
      for(const name of ["brightness","contrast","saturation","hue"])gl.uniform1f(uniforms[name],p[name]);
      gl.uniform1i(uniforms.recolorEnabled,p.recolor_enabled?1:0);
      gl.uniform1i(uniforms.recolorAllBlack,p.recolor_all_black?1:0);
      if(p.recolor_enabled)gl.uniform3f(uniforms.replacementColor,...replacementRGB(p.replacement_color));
      gl.uniform1f(uniforms.gammaValue,p.gamma);gl.disable(gl.BLEND);gl.disable(gl.DITHER);gl.drawArrays(gl.TRIANGLES,0,3);
    },
    dispose(){gl.deleteTexture(texture);gl.deleteTexture(distanceTexture);gl.deleteTexture(protectionTexture);gl.deleteBuffer(buffer);gl.deleteProgram(program);pixels=null;analysis.width=analysis.height=1;}
  };
}
