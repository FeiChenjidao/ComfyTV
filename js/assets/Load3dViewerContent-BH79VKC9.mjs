import { bm as defineComponent, bP as openBlock, bg as createElementBlock, bc as createBaseVNode, c4 as toDisplayString } from "./main-hcmMPtpz.mjs";
const _hoisted_1 = { class: "ctv:flex ctv:size-full ctv:items-center ctv:justify-center ctv:p-4 ctv:text-sm ctv:text-muted-foreground" };
const _hoisted_2 = ["href"];
const _sfc_main = /* @__PURE__ */ defineComponent({
  __name: "Load3dViewerContent",
  props: {
    modelUrl: {}
  },
  setup(__props) {
    return (_ctx, _cache) => {
      return openBlock(), createElementBlock("div", _hoisted_1, [
        createBaseVNode("a", {
          href: __props.modelUrl,
          target: "_blank",
          rel: "noopener",
          class: "ctv:underline"
        }, toDisplayString(__props.modelUrl), 9, _hoisted_2)
      ]);
    };
  }
});
export {
  _sfc_main as default
};
//# sourceMappingURL=Load3dViewerContent-BH79VKC9.mjs.map
