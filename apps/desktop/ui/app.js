const state = {
  pickToken: "",
  rootId: "",
  scanId: "",
  workspaceId: "",
};

const logEl = document.querySelector("#log");
const evidenceEl = document.querySelector("#evidence");
const conversationEl = document.querySelector("#conversation");

function show(value) {
  logEl.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function invoke(command, args) {
  const tauri = window.__TAURI__;
  if (!tauri || !tauri.core || !tauri.core.invoke) {
    return Promise.reject(new Error("Tauri invoke 不可用。请从 hark-desktop 窗口打开，不要用浏览器直接打开文件。"));
  }
  return tauri.core.invoke(command, args || {});
}

function errorText(error) {
  if (error && typeof error === "object") {
    const code = error.code || "";
    const detail = error.detail || error.message || "";
    if (code === "scan_already_running" || code === "read_already_running") {
      return code + "：" + (detail || "已有进行中的任务。这次没有开始，也没有取消原来的任务。");
    }
    if (code) return code + (detail ? "：" + detail : "");
    if (error.message) return String(error.message);
  }
  return error == null ? "" : String(error);
}

async function run(label, fn) {
  try {
    const value = await fn();
    show({ ok: label, value });
    return value;
  } catch (error) {
    show({ failed: label, error: errorText(error) });
    return null;
  }
}

function setIds() {
  document.querySelector("#root-id").value = state.rootId;
  document.querySelector("#workspace-id").value = state.workspaceId;
}

document.querySelector("#pick").addEventListener("click", () => {
  run("pick_directory", async () => {
    const ticket = await invoke("pick_directory");
    state.pickToken = ticket.pickToken;
    document.querySelector("#pick-summary").textContent =
      "已选择「" + ticket.displayName + "」。" + ticket.directoryRead + ticket.remoteModel;
    return ticket;
  });
});

document.querySelector("#authorize-scan").addEventListener("click", () => {
  run("authorize_and_scan", async () => {
    const root = await invoke("authorize_picked", { request: { pickToken: state.pickToken } });
    state.rootId = root.id;
    const scan = await invoke("scan_root", { rootId: root.id });
    state.scanId = scan.id;
    renderCandidates(scan);
    evidenceEl.textContent = JSON.stringify(
      { coverage: scan.coverage, limitsHit: scan.limitsHit, ignored: scan.ignored, candidates: scan.candidates },
      null,
      2,
    );
    setIds();
    return { rootId: root.id, scanId: scan.id, status: scan.status };
  });
});

document.querySelector("#cancel-scan").addEventListener("click", () => {
  run("cancel_scan", () => invoke("cancel_scan", { rootId: state.rootId }));
});

function renderCandidates(scan) {
  const host = document.querySelector("#candidates");
  host.replaceChildren();
  for (const candidate of scan.candidates || []) {
    const label = document.createElement("label");
    label.className = "candidate";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.value = candidate.id;
    box.disabled = candidate.role === "single_root";
    const text = document.createElement("span");
    text.textContent =
      " " +
      (candidate.relativePath || "（整个目录）") +
      " · " +
      candidate.role +
      " · " +
      (candidate.evidence || []).join(", ");
    label.append(box, text);
    host.append(label);
  }
}

function selectedIds() {
  return Array.from(document.querySelectorAll("#candidates input:checked")).map((node) => node.value);
}

document.querySelector("#confirm-single").addEventListener("click", () => {
  confirm({ kind: "single" });
});

document.querySelector("#confirm-selected").addEventListener("click", () => {
  confirm({ kind: "selected", candidateIds: selectedIds() });
});

function confirm(selection) {
  run("confirm_import", async () => {
    const result = await invoke("confirm_import", {
      request: { rootId: state.rootId, scanId: state.scanId, selection },
    });
    const first = (result.workspaces || [])[0];
    if (first) state.workspaceId = first.id;
    setIds();
    return result;
  });
}

document.querySelector("#read").addEventListener("click", () => {
  run("selective_key_read", async () => {
    const report = await invoke("selective_key_read", { workspaceId: state.workspaceId });
    const sources = await invoke("list_source_refs", { workspaceId: state.workspaceId });
    evidenceEl.textContent = JSON.stringify({ report, sources }, null, 2);
    return report;
  });
});

document.querySelector("#card").addEventListener("click", () => {
  run("commit_local_scan_card", async () => {
    const card = await invoke("commit_local_scan_card", { workspaceId: state.workspaceId });
    await refresh();
    return card;
  });
});

document.querySelector("#refresh").addEventListener("click", () => {
  run("refresh", refresh);
});

document.querySelector("#cancel-onboarding").addEventListener("click", () => {
  run("cancel_onboarding", () => invoke("cancel_onboarding", { workspaceId: state.workspaceId }));
});

document.querySelector("#retry-onboarding").addEventListener("click", () => {
  run("retry_onboarding", () => invoke("retry_onboarding", { workspaceId: state.workspaceId }));
});

document.querySelector("#note-save").addEventListener("click", () => {
  run("append_user_message", async () => {
    const text = document.querySelector("#note").value;
    const event = await invoke("append_user_message", {
      request: { workspaceId: state.workspaceId, text },
    });
    await refresh();
    return event;
  });
});

for (const [id, command] of [
  ["pause", "pause_directory"],
  ["resume", "resume_directory"],
  ["revoke", "revoke_directory"],
]) {
  document.querySelector("#" + id).addEventListener("click", () => {
    run(command, () => invoke(command, { rootId: state.rootId }));
  });
}

document.querySelector("#opening").addEventListener("click", () => {
  run("start_configured_opening", () =>
    invoke("start_configured_opening", { request: { workspaceId: state.workspaceId } }),
  );
});

document.querySelector("#hide").addEventListener("click", () => {
  run("hide_window", () => invoke("hide_window"));
});

document.querySelector("#quit").addEventListener("click", () => {
  run("quit_app", () => invoke("quit_app"));
});

async function refresh() {
  const snapshot = await invoke("shell_snapshot");
  document.querySelector("#sidecar").textContent =
    "Sidecar：" + snapshot.sidecar.reason + " Windows Job Object：" + snapshot.sidecar.windowsJobObject;
  if (!state.workspaceId && snapshot.workspaces && snapshot.workspaces[0]) {
    state.workspaceId = snapshot.workspaces[0].id;
  }
  if (!state.rootId && snapshot.roots && snapshot.roots[0]) {
    state.rootId = snapshot.roots[0].id;
  }
  setIds();
  if (!state.workspaceId) {
    document.querySelector("#analysis-label").textContent = "还没有 Workspace。";
    return snapshot;
  }
  const [events, onboarding, overview, grants] = await Promise.all([
    invoke("list_conversation", { workspaceId: state.workspaceId }),
    invoke("onboarding", { workspaceId: state.workspaceId }),
    invoke("workspace_overview", { workspaceId: state.workspaceId }),
    invoke("service_grants", { workspaceId: state.workspaceId }),
  ]);
  const analyzed = Boolean(onboarding.modelAnalyzed || overview.modelAnalyzed || overview.modelInference);
  document.querySelector("#analysis-label").textContent = analyzed
    ? "模型分析标记为真。本壳不应产生这个状态。"
    : "本地发现，尚未模型分析。远程模型等待授权，未调用。";
  conversationEl.textContent = (events || [])
    .map((event) => event.kind + "\n" + event.body)
    .join("\n\n");
  evidenceEl.textContent = JSON.stringify({ onboarding, overview, grants, snapshotNotes: snapshot.notes }, null, 2);
  return { snapshot, onboarding, overview };
}

refresh().catch((error) => show(String(error)));
