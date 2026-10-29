import { app as app } from "../../../scripts/app.js";
import { api as api } from "../../../scripts/api.js";
import { sendMsg, addListener } from "./connection.js";
import { photoshopNode } from "./nodestyle.js";

export const nodever = "1.9.3";
let workflowSwitcher = "";
let rndrModeSwitcher = "";

addListener("photoshopConnected", () => {
  console.log("🔹photoshopConnected");
  try {
    scanSwitchers();
    if (workflowSwitcher) publishSwitcher("Send_workflow", workflowSwitcher);
    else if (announcedGraphKey) publishNoWorkflowGroup();
    if (rndrModeSwitcher) publishRenderModes();
  } catch (error) {
    console.error("🔹 Error in photoshopConnected listener:", error);
  }
});

addListener("workflow", (data) => {
  try {
    rememberMode(activeWidgetTitle(rndrModeSwitcher));
    activateSwitcherWidget(workflowSwitcher, data);
    const workflow = widgetTitle(workflowSwitcher?.widgets?.[Number(data)]) || activeWidgetTitle(workflowSwitcher);
    const mode = lastModeByWorkflow[workflow] || (WORKFLOW_MODES[workflow] || [])[0];
    if (mode) applyMode(mode);
    publishSwitcher("Send_workflow", workflowSwitcher);
    publishRenderModes();
  } catch (error) {
    console.error("🔹 Error in workflow listener:", error);
  }
});

addListener("alert", (data) => {
  try {
    alert(data);
  } catch (error) {
    console.error("🔹 Error in alert listener:", error);
  }
});

addListener("queue", () => {
  try {
    if (isProcessing) return;
    isProcessing = true;
    (function processQueue() {
      if (genrateStatus == "genrated") {
        app.queuePrompt();
        isProcessing = false;
      } else {
        setTimeout(processQueue, 100);
      }
    })();
  } catch (error) {
    isProcessing = false;
    console.error("🔹 Error in queue listener:", error);
  }
});

addListener("rndrMode", (data) => {
  try {
    const name = publishedModeNames[Number(data)];
    if (name) applyMode(name);
    else activateSwitcherWidget(rndrModeSwitcher, data);
    publishRenderModes();
  } catch (error) {
    console.error("🔹 Error in rndrMode listener:", error);
  }
});

// 新版 rgthree 的控件名是 RGTHREE_TOGGLE_AND_NAV，分组标题在 label 的 "Enable …" 里。
// value 是 {toggled} 对象，不能拿来当布尔值，否则每一项都会被当成选中。
function switcherWidgetOn(widget) {
  if (widget?.toggled === true) return true;
  if (widget?.value && typeof widget.value === "object") return widget.value.toggled === true;
  return widget?.value === true;
}

const INTERNAL_MUTER_NAME = /^RGTHREE_TOGGLE_AND_NAV(#\d+)?$/;

function readableSwitcherName(value) {
  if (typeof value !== "string") return "";
  const name = value.trim().replace(/^Enable\s+/, "");
  if (!name || INTERNAL_MUTER_NAME.test(name)) return "";
  return name;
}

function switcherEntry(widget) {
  const name =
    readableSwitcherName(widget?.group?.title) ||
    readableSwitcherName(widget?.displayName) ||
    readableSwitcherName(widget?.label) ||
    readableSwitcherName(widget?.name);
  if (!name) return null;
  return switcherWidgetOn(widget) ? { name, selected: true } : { name };
}

function activateSwitcherWidget(switcher, index) {
  const widget = switcher?.widgets?.[Number(index)];
  if (!widget) return;
  if (typeof widget.doModeChange === "function") {
    widget.doModeChange(true);
    return;
  }
  if (typeof widget.callback === "function") widget.callback();
}

const WORKFLOW_MODES = {
  NanoBanana: ["NanoBanana 2K", "NanoBanana 4K"],
  GPT: ["GPT 不透明", "GPT 半透明"],
};
const lastModeByWorkflow = {
  NanoBanana: "NanoBanana 2K",
  GPT: "GPT 不透明",
};
let publishedModeNames = [];
let lastRenderPayload = "";

function widgetTitle(widget) {
  return (
    readableSwitcherName(widget?.group?.title) ||
    readableSwitcherName(widget?.displayName) ||
    readableSwitcherName(widget?.label) ||
    readableSwitcherName(widget?.name)
  );
}

function activeWidgetTitle(switcher) {
  for (const widget of switcher?.widgets || []) {
    if (!switcherWidgetOn(widget)) continue;
    const name = widgetTitle(widget);
    if (name) return name;
  }
  return "";
}

function widgetIndexByTitle(switcher, title) {
  const widgets = switcher?.widgets || [];
  for (let index = 0; index < widgets.length; index += 1) {
    if (widgetTitle(widgets[index]) === title) return index;
  }
  return -1;
}

function rememberMode(modeName) {
  for (const [workflow, modes] of Object.entries(WORKFLOW_MODES)) {
    if (modes.includes(modeName)) lastModeByWorkflow[workflow] = modeName;
  }
}

function applyMode(modeName) {
  const index = widgetIndexByTitle(rndrModeSwitcher, modeName);
  if (index < 0) return false;
  activateSwitcherWidget(rndrModeSwitcher, index);
  rememberMode(modeName);
  return true;
}

function enabledModeNames() {
  const names = [];
  for (const widget of rndrModeSwitcher?.widgets || []) {
    if (!switcherWidgetOn(widget)) continue;
    const name = widgetTitle(widget);
    if (name) names.push(name);
  }
  return names;
}

function collapseToOneMode() {
  const workflow = activeWidgetTitle(workflowSwitcher);
  const allowed = WORKFLOW_MODES[workflow];
  if (!allowed) return;
  const enabled = enabledModeNames().filter((name) => allowed.includes(name));
  if (enabled.length === 1) {
    rememberMode(enabled[0]);
    return;
  }
  applyMode(lastModeByWorkflow[workflow] || allowed[0]);
}

function switcherSignature(switcher) {
  return (switcher?.widgets || [])
    .map((widget) => `${widget?.label || ""}|${widget?.name || ""}|${switcherWidgetOn(widget)}`)
    .join("\n");
}

const SwitcherWidgetNames = (switcher) => {
  try {
    const entries = (switcher.widgets || []).map(switcherEntry);
    if (!entries.length || entries.some((entry) => !entry)) return [];
    return entries;
  } catch (error) {
    console.error("🔹 Error in SwitcherWidgetNames:", error);
    return [];
  }
};

function publishSwitcher(kind, switcher) {
  const names = SwitcherWidgetNames(switcher);
  if (names.length) sendMsg(kind, names);
}

function publishRenderModes() {
  if (!rndrModeSwitcher) return;
  const workflow = activeWidgetTitle(workflowSwitcher);
  const allowed = WORKFLOW_MODES[workflow];
  if (!allowed) return;
  rememberMode(activeWidgetTitle(rndrModeSwitcher));
  const names = SwitcherWidgetNames(rndrModeSwitcher);
  if (!names.length) return;
  const available = new Set(names.map((entry) => entry.name));
  if (!allowed.every((name) => available.has(name))) return;
  let selected = activeWidgetTitle(rndrModeSwitcher);
  if (!allowed.includes(selected)) selected = lastModeByWorkflow[workflow] || allowed[0];
  publishedModeNames = allowed.slice();
  const entries = allowed.map((name) => (name === selected ? { name, selected: true } : { name }));
  const payload = JSON.stringify(entries);
  if (payload === lastRenderPayload) return;
  lastRenderPayload = payload;
  sendMsg("Send_rndrMode", entries);
}

// Register extension with ComfyUI
app.registerExtension({
  name: "PhotoshopToComfyUINode",
  async beforeRegisterNodeDef(nodeType, nodeInfo, appInstance) {
    if (nodeInfo.category === "Photoshop") {
      appendMenuOption(nodeType, (_, menuOptions) => {
        menuOptions.unshift({
          content: "🔹 Install PS Plugin V" + nodever,
          callback: () => sendMsg("install_plugin"),
        });
      });
    }
  },

  onProgressUpdate(event) {
    try {
      if (!this.connected) return;
      let prompt = event.detail.prompt;
      this.currentPromptExecution = prompt;
      if (prompt?.errorDetails) {
        let errorText = `${prompt.errorDetails?.exception_type} ${prompt.errorDetails?.node_id || ""} ${
          prompt.errorDetails?.node_type || ""
        }`;
        this.progressTextEl.innerText = errorText;
        this.progressNodesEl.classList.add("-error");
        this.progressStepsEl.classList.add("-error");
        return;
      }
    } catch (error) {
      console.error("🔹 Error in onProgressUpdate:", error);
    }
  },

  async nodeCreated() {
    try {
      scanSwitchers();
    } catch (error) {
      console.error("🔹 Error in nodeCreated:", error);
    }
  },
});

async function getWorkflow(name) {
  try {
    console.log("name: ", name);
    const response = await api.fetchApi(`/ps/workflows/${encodeURIComponent(name)}`, { cache: "no-store" });
    console.log("response: ", response);
    return await response.json();
  } catch (error) {
    console.error("🔹 Error in getWorkflow:", error);
  }
}

export async function loadWorkflow(workflowName) {
  const supportedLocales = ["ja-JP", "ko-KR", "zh-TW", "zh-CN"];
  let currentLocale = localStorage.getItem("AGL.Locale");

  if (!supportedLocales.includes(currentLocale)) {
    currentLocale = "en-US";
  }

  console.log("🔹 Load workflow for this language:", currentLocale);
  workflowName = workflowName + "_" + currentLocale;
  try {
    const workflowData = await getWorkflow(workflowName);
    app.loadGraphData(workflowData);
  } catch (error) {
    console.error(`Failed to load workflow ${workflowName}:`, error);
    alert(`Failed to load workflow ${workflowName}`);
  }
}

let genrateStatus = "genrated";
let isProcessing = false;

function overallProgress(nodes) {
  const list = Object.values(nodes || {});
  if (!list.length) return null;
  let sum = 0;
  for (const node of list) {
    const max = Number(node.max) || 0;
    const value = Number(node.value) || 0;
    if (node.state === "finished" || node.state === "error") sum += 1;
    else if (max > 0) sum += Math.max(0, Math.min(1, value / max));
  }
  return Math.max(0, Math.min(100, Math.round((sum / list.length) * 100)));
}

let sawProgressState = false;

api.addEventListener("execution_start", ({ detail }) => {
  try {
    genrateStatus = "genrating";
    sawProgressState = false;
    sendMsg("render_status", "genrating");
  } catch (error) {
    console.error("🔹 Error in execution_start listener:", error);
  }
});
api.addEventListener("executing", ({ detail }) => {
  try {
    if (!detail) {
      genrateStatus = "genrated";
      isProcessing = false;
      sendMsg("render_status", "genrated");
    }
  } catch (error) {
    console.error("🔹 Error in executing listener:", error);
  }
});
api.addEventListener("execution_error", ({ detail }) => {
  try {
    genrateStatus = "genrate_error";
    sendMsg("render_status", "genrate_error");
  } catch (error) {
    console.error("🔹 Error in execution_error listener:", error);
  }
});
api.addEventListener("progress_state", ({ detail }) => {
  try {
    const percent = overallProgress(detail?.nodes);
    if (percent == null) return;
    sawProgressState = true;
    sendMsg("progress", percent);
  } catch (error) {
    console.error("🔹 Error in progress_state listener:", error);
  }
});
api.addEventListener("progress", ({ detail: { value, max } }) => {
  try {
    if (sawProgressState) return;
    let progress = Math.floor((value / max) * 100);
    if (!isNaN(progress) && progress >= 0 && progress <= 100) {
      sendMsg("progress", progress);
    }
  } catch (error) {
    console.error("🔹 Error in progress listener:", error);
  }
});

export function appendMenuOption(nodeType, callbackFn) {
  const originalMenuOptions = nodeType.prototype.getExtraMenuOptions;
  nodeType.prototype.getExtraMenuOptions = function () {
    const options = originalMenuOptions.apply(this, arguments);
    callbackFn.apply(this, arguments);
    return options;
  };
}

let announcedGraphKey = "";
const NO_WORKFLOW_GROUP = [{ name: "当前画布没有工作流分组", selected: true }];

function graphNodes() {
  return app.graph?._nodes || [];
}

function isMuter(node) {
  return node?.comfyClass == "Fast Groups Muter (rgthree)" || node?.type == "Fast Groups Muter (rgthree)";
}

function isWorkflowMuter(node) {
  const title = String(node?.title || "");
  return isMuter(node) && (node.color == "#2b4557" || node.bgcolor == "#2b4557" || title.startsWith("📁"));
}

function isRenderMuter(node) {
  const title = String(node?.title || "");
  return isMuter(node) && (node.color == "#4e5e4e" || node.bgcolor == "#4e5e4e" || title.startsWith("⚙️"));
}

function publishNoWorkflowGroup() {
  sendMsg("Send_workflow", NO_WORKFLOW_GROUP);
}

function scanSwitchers() {
  const nodes = graphNodes();
  if (workflowSwitcher && nodes.indexOf(workflowSwitcher) < 0) {
    workflowSwitcher = "";
    announcedGraphKey = "";
  }
  if (rndrModeSwitcher && nodes.indexOf(rndrModeSwitcher) < 0) {
    rndrModeSwitcher = "";
  }
  for (const node of nodes) {
    if (!workflowSwitcher && isWorkflowMuter(node)) {
      workflowSwitcher = node;
      console.log("🔹 workflowSwitcher detected: ", workflowSwitcher);
      publishSwitcher("Send_workflow", workflowSwitcher);
      workflowswitcherchecker();
    }
    if (!rndrModeSwitcher && isRenderMuter(node)) {
      rndrModeSwitcher = node;
      console.log("🔹 rndrModeSwitcher detected: ", rndrModeSwitcher);
      publishRenderModes();
      rndrswitcherchecker();
    }
  }
  if (workflowSwitcher || !nodes.length) return;
  const key = nodes.map((node) => String(node.id)).join(",");
  if (key === announcedGraphKey) return;
  const relevant = nodes.some(
    (node) => isRenderMuter(node) || node?.comfyClass === "🔹Photoshop ComfyUI Plugin" || node?.type === "🔹Photoshop ComfyUI Plugin"
  );
  if (!relevant) return;
  announcedGraphKey = key;
  publishNoWorkflowGroup();
}

function workflowswitcherchecker() {
  let previousWorkflowWidgets = switcherSignature(workflowSwitcher);

  setInterval(() => {
    try {
      const currentWorkflowWidgets = switcherSignature(workflowSwitcher);
      if (currentWorkflowWidgets !== previousWorkflowWidgets) {
        console.log("Workflow switcher widgets have changed");
        collapseToOneMode();
        publishSwitcher("Send_workflow", workflowSwitcher);
        publishRenderModes();
        previousWorkflowWidgets = currentWorkflowWidgets;
      }
    } catch (error) {
      console.error("🔹 Error in workflow switcher widget change detection:", error);
    }
  }, 3000);
}

setInterval(() => {
  try {
    scanSwitchers();
  } catch (error) {
    console.error("🔹 Error scanning switchers:", error);
  }
}, 2000);

function rndrswitcherchecker() {
  let previousRndrModeWidgets = switcherSignature(rndrModeSwitcher);

  setInterval(() => {
    try {
      const currentRndrModeWidgets = switcherSignature(rndrModeSwitcher);
      if (currentRndrModeWidgets !== previousRndrModeWidgets) {
        console.log("Render mode switcher widgets have changed");
        publishRenderModes();
        previousRndrModeWidgets = currentRndrModeWidgets;
      }
    } catch (error) {
      console.error("🔹 Error in render mode switcher widget change detection:", error);
    }
  }, 3000);
}
