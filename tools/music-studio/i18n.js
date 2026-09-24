// Standalone i18n for Music Studio. Same mechanism as the other studio
// tools: language from localStorage "obr-suite/lang" (shared with the
// plugin) → navigator.language fallback; data-i18n* apply; ZH/EN toggle.

export const LANG = (() => {
  try {
    const v = localStorage.getItem("obr-suite/lang");
    if (v === "en" || v === "zh") return v;
  } catch {}
  try {
    return (navigator.language || "").toLowerCase().startsWith("zh") ? "zh" : "en";
  } catch {}
  return "zh";
})();

const TR = {
  // shared studio chrome
  navMonster: { zh: "怪物编辑", en: "Monster" },
  navBuff: { zh: "Buff 合成", en: "Buff FX" },
  navDice: { zh: "骰子工坊", en: "Dice" },
  navMusic: { zh: "音乐板", en: "Music" },
  langToggle: { zh: "EN", en: "中文" },
  langToggleTitle: { zh: "Switch to English", en: "切换到中文" },
  muBrand: { zh: "OBR 音乐板", en: "OBR Music Board" },

  // pairing widget
  muPairBtn: { zh: "配对枭熊", en: "Pair OBR" },
  muPairBtnTitle: { zh: "生成配对码，让枭熊插件连接", en: "Generate a code so the OBR plugin can connect" },
  muPairCopyTitle: { zh: "点击复制配对码", en: "Click to copy the pairing code" },
  muPairCodeLabel: { zh: "配对码", en: "Code" },
  muPairCancelTitle: { zh: "取消配对", en: "Cancel pairing" },
  muConnected: { zh: "已连接", en: "Connected" },
  muDisconnect: { zh: "断开", en: "Disconnect" },

  // decks
  muDropToPlay: { zh: "拖卡片到这里播放", en: "Drop a card here to play" },
  muIdle: { zh: "-- 空闲 --", en: "-- idle --" },
  muEmpty: { zh: "空", en: "empty" },
  muUnnamed: { zh: "未命名", en: "Untitled" },
  muPrev: { zh: "上一首", en: "Previous" },
  muNext: { zh: "下一首", en: "Next" },
  muNone: { zh: "无", en: "none" },
  muPlayPause: { zh: "播放/暂停", en: "Play / pause" },
  muStop: { zh: "停止", en: "Stop" },
  muLoop: { zh: "单曲循环", en: "Loop" },
  muLoopTitle: { zh: "当前 BGM 是否单曲循环", en: "Loop the current BGM track" },
  muFade: { zh: "淡入淡出", en: "Crossfade" },
  muFadeTitle: { zh: "切歌/启停时是否淡入淡出", en: "Fade in / out on track change + start / stop" },

  // favorites + library
  muFav: { zh: "常用", en: "Favorites" },
  muFavHint: { zh: "拖入收藏 · 点击或拖到唱片台播放 · 右上 × 移除", en: "Drag in to favorite · click or drag onto a deck to play · × to remove" },
  muClear: { zh: "清空", en: "Clear" },
  muFavEmpty: { zh: "拖任意曲目到这里收藏", en: "Drag any track here to favorite it" },
  muLibrary: { zh: "曲库", en: "Library" },
  muSearchPh: { zh: "搜索…", en: "Search…" },
  muDetails: { zh: "详细信息", en: "Details" },
  muDetailsTitle: { zh: "显示/隐藏 时长·音质·大小（关闭可让卡片更紧凑）", en: "Show / hide duration · quality · size (off = more compact cards)" },
  muDefaults: { zh: "默认曲库", en: "Default library" },
  muDefaultsTitle: { zh: "从服务器拉默认曲库（~108 MB）", en: "Pull the default library from the server (~108 MB)" },
  muAddUrl: { zh: "+ 外链", en: "+ URL" },
  muAddFile: { zh: "+ 文件", en: "+ File" },
  muLibEmptyTitle: { zh: "曲库是空的", en: "The library is empty" },
  muLibEmptyHint: { zh: "把音频文件拖到这里 → 自动打开编辑器<br>或点右上「+ 文件 / + 外链」<br>或点「默认曲库」拉服务器自带的 154 首", en: "Drop audio files here → the editor opens automatically<br>or use \"+ File / + URL\" top-right<br>or click \"Default library\" for the 154 bundled tracks" },
  muNoMatch: { zh: "没有匹配的曲目", en: "No matching tracks" },
  muDropImport: { zh: "松开导入并打开编辑器", en: "Release to import + open the editor" },
  muAll: { zh: "全部", en: "All" },

  // track card actions
  muDelete: { zh: "删除", en: "Delete" },
  muConfirmDelTrack: { zh: "删除「{name}」？", en: 'Delete "{name}"?' },
  muRightClickColor: { zh: "右键改颜色", en: "Right-click to change color" },
  muAddTag: { zh: "添加标签", en: "Add tags" },
  muColorTitle: { zh: "「{name}」颜色", en: '"{name}" color' },
  muRestoreDefault: { zh: "恢复默认", en: "Restore default" },
  muLocalNoShare: { zh: "本地压缩文件无法分享给其他玩家。请使用在线直链。", en: "Locally-compressed files can't be shared with other players. Use an online direct link." },
  muLocalNoShareTip: { zh: "本地压缩文件，无法分享给其他玩家。请使用在线直链。", en: "Locally-compressed file — can't be shared with other players. Use an online direct link." },
  muLocalNoShareAria: { zh: "本地压缩文件，无法分享给其他玩家", en: "Locally-compressed file, can't be shared with other players" },

  // favorites interactions
  muPlayingClickStop: { zh: "正在播放，再点一次停止", en: "Playing — click again to stop" },
  muClickToPlay: { zh: "点击或拖到唱片台播放：{name}", en: "Click or drag onto a deck to play: {name}" },
  muRemoveFav: { zh: "从常用移除", en: "Remove from favorites" },
  muConfirmClearFav: { zh: "清空常用列表（{n} 首）？", en: "Clear the favorites list ({n} tracks)?" },
  muAlreadyFav: { zh: "已在常用", en: "Already favorited" },

  // toasts — playback / import / dedup
  muPlayFail: { zh: "播放失败：{err}", en: "Playback failed: {err}" },
  muBgmIdle: { zh: "BGM 唱片台空闲", en: "The BGM deck is idle" },
  muFadeToggled: { zh: "淡入淡出 {state}", en: "Crossfade {state}" },
  muOn: { zh: "开", en: "on" },
  muOff: { zh: "关", en: "off" },
  muDedup: { zh: "库自动去重：移除 {n} 个同 URL 重复条目", en: "Auto-deduped the library: removed {n} same-URL duplicates" },
  muNoAudioFile: { zh: "没识别到音频文件", en: "No audio files detected" },
  muMultiFileFirst: { zh: "检测到 {n} 个文件，先编辑第一个", en: "Detected {n} files — editing the first one" },
  muDecoding: { zh: "解码中…", en: "Decoding…" },
  muStereo: { zh: "立体", en: "Stereo" },
  muMono: { zh: "单", en: "Mono" },
  muDecodeFail: { zh: "解码失败 —— 浏览器可能不支持该编码", en: "Decode failed — your browser may not support this codec" },

  // editor modal
  muEditTrack: { zh: "编辑曲目", en: "Edit track" },
  muTrackNamePh: { zh: "曲目名称", en: "Track name" },
  muStart: { zh: "起点", en: "Start" },
  muEnd: { zh: "终点", en: "End" },
  muTrimLen: { zh: "截取", en: "Clip" },
  muReset: { zh: "重置", en: "Reset" },
  muBitrate: { zh: "码率", en: "Bitrate" },
  muChannel: { zh: "声道", en: "Channels" },
  muRouteTo: { zh: "归到", en: "Route to" },
  muLoopChk: { zh: "循环", en: "Loop" },
  muSizeEst: { zh: "预计大小", en: "Est. size" },
  muOrigSize: { zh: "原始大小", en: "Original size" },
  muPreview: { zh: "预览截取段", en: "Preview clip" },
  muStopPreview: { zh: "停止预览", en: "Stop preview" },
  muEncode: { zh: "压缩并加入库", en: "Compress + add to library" },
  muPreparing: { zh: "准备中…", en: "Preparing…" },
  muTrimTooShort: { zh: "截取段过短", en: "Clip is too short" },
  muAddedToLib: { zh: "「{name}」已加入库（{size}）", en: '"{name}" added to the library ({size})' },
  muEncodeFail: { zh: "编码失败：{err}", en: "Encoding failed: {err}" },

  // URL modal
  muUrlTitle: { zh: "添加 / 批量导入外链", en: "Add / batch-import URLs" },
  muUrlHint: { zh: "粘贴音频直链（.mp3/.ogg/.m4a 等）。<b>可一次粘贴多条</b>——用回车 / 逗号 / 空格分隔。也支持<b>网易云</b>分享链接或歌曲 id（自动转成可播放直链，仅限非 VIP 歌曲）。QQ 音乐需要动态 vkey，暂不支持静态链接。", en: "Paste audio direct links (.mp3/.ogg/.m4a …). <b>Paste several at once</b> — separated by newlines / commas / spaces. <b>NetEase Music</b> share links or song ids also work (auto-converted to playable links, non-VIP songs only). QQ Music needs a dynamic vkey, so static links aren't supported." },
  muUrlPh: { zh: "每行一条，例如：\nhttps://example.com/bgm.mp3\nhttps://music.163.com/song?id=33894312\n5264952", en: "One per line, e.g.:\nhttps://example.com/bgm.mp3\nhttps://music.163.com/song?id=33894312\n5264952" },
  muName: { zh: "名称", en: "Name" },
  muUrlNamePh: { zh: "仅单条时生效；批量自动推断", en: "Single only; names auto-inferred when batching" },
  muUrlAdd: { zh: "添加到库", en: "Add to library" },
  muImportN: { zh: "导入 {n} 条", en: "Import {n}" },
  muCancel: { zh: "取消", en: "Cancel" },
  muExtMusic: { zh: "外链音乐", en: "URL track" },
  muReasonEmpty: { zh: "空", en: "empty" },
  muReasonNoId: { zh: "网易云链接里没找到歌曲 id", en: "no song id found in the NetEase link" },
  muReasonQQ: { zh: "QQ 音乐需要动态 vkey，无法用静态链接播放", en: "QQ Music needs a dynamic vkey; static links can't play" },
  muReasonNotLink: { zh: "不是 http(s) 直链 / 网易云链接 / 歌曲 id", en: "not an http(s) link / NetEase link / song id" },
  muNeteaseName: { zh: "网易云 {id}", en: "NetEase {id}" },
  muImported: { zh: "已导入 {n} 条", en: "Imported {n}" },
  muSkippedDup: { zh: " · 跳过 {n} 个重复", en: " · skipped {n} duplicate(s)" },
  muUnrecognized: { zh: " · {n} 个无法识别", en: " · {n} unrecognized" },

  // tag modal
  muTagTitle: { zh: "编辑标签", en: "Edit tags" },
  muTagHint: { zh: "空格 / 逗号 / 回车 分隔。", en: "Separate with spaces / commas / newlines." },
  muTagPh: { zh: "紧张 战斗 Boss", en: "tense combat boss" },
  muSave: { zh: "保存", en: "Save" },

  // default-library load
  muLoading: { zh: "拉取中…", en: "Loading…" },
  muDefaultEmpty: { zh: "默认曲库还是空的", en: "The default library is still empty" },
  muDefaultTag: { zh: "默认", en: "default" },
  muDefaultTrack: { zh: "默认曲目", en: "Default track" },
  muNew: { zh: "新增 {n}", en: "{n} added" },
  muBackfilled: { zh: "回填 {n}", en: "{n} backfilled" },
  muReady: { zh: "{n} 首已就绪", en: "{n} already loaded" },
  muDefaultsResult: { zh: "默认曲库：{summary}", en: "Default library: {summary}" },
  muDefaultsFail: { zh: "无法加载默认曲库：{err}", en: "Couldn't load the default library: {err}" },

  // local-mute banner
  muMutedBanner: { zh: "仅网页静音 · 不影响枭熊音量或暂停状态", en: "Website muted only · Owlbear volume and playback are unchanged" },
  muAudibleBanner: { zh: "网页声音已启用 · 与枭熊共享播放状态", en: "Website sound enabled · playback state is shared with Owlbear" },
  muLocalSoundBlocked: { zh: "网页声音被浏览器拦截，请点击「在本地也播放」重试；枭熊播放不受影响。", en: "Website sound was blocked. Click Play locally too to retry; Owlbear playback is unaffected." },
  muRoomPermission: { zh: "当前没有房间音乐控制权限，已恢复房间状态。", en: "You cannot control room music right now. Room playback was restored." },
  muRoomCommandFailed: { zh: "房间音乐未确认此操作，请查看枭熊连接后重试。", en: "Room music did not confirm this action. Check the Owlbear connection, then retry." },
  muPlayLocal: { zh: "在本地也播放", en: "Play locally too" },
  muMuteLocal: { zh: "本地静音", en: "Mute locally" },

  // pairing toasts
  muConfirmUnpair: { zh: "确定断开与枭熊的连接？", en: "Disconnect from OBR?" },
  muPairCopied: { zh: "配对码 {code} 已复制", en: "Pairing code {code} copied" },
  muPairCopyManual: { zh: "配对码：{code}（手动复制）", en: "Pairing code: {code} (copy manually)" },
  muPairReady: { zh: "配对码 {code} 已就绪，等枭熊插件连接…", en: "Pairing code {code} ready — waiting for the OBR plugin…" },
  muXiongConnected: { zh: "枭熊已连接 · 已仅静音网页，枭熊音量不变", en: "OBR connected · website muted only; Owlbear volume unchanged" },
  muXiongDisconnected: { zh: "枭熊断开，回到等待", en: "OBR disconnected — back to waiting" },
  muChannelError: { zh: "通道错误：{err}", en: "Channel error: {err}" },
  muPairFail: { zh: "配对失败：{err}", en: "Pairing failed: {err}" },
  muPeerLoadFail: { zh: "加载 PeerJS 失败：{err}", en: "Failed to load PeerJS: {err}" },
  muLeaveConfirm: { zh: "离开后网页控制会断开，枭熊后台继续播放。确定离开？", en: "Leaving disconnects website controls. Owlbear background keeps playing. Leave?" },
  muLibLoadFail: { zh: "库加载失败：{err}", en: "Library failed to load: {err}" },

  // share.js
  muShareLocalErr: { zh: "「{name}」是本地压缩文件，需要先上传到某个直链地址才能分享。", en: '"{name}" is a locally-compressed file — upload it to a direct-link URL before sharing.' },

  // encoder.js progress
  muEncLoadFfmpeg: { zh: "加载 ffmpeg…", en: "Loading ffmpeg…" },
  muEncEncoding: { zh: "编码中…", en: "Encoding…" },
  muEncWriting: { zh: "写入文件…", en: "Writing file…" },
  muEncReading: { zh: "读取结果…", en: "Reading result…" },
  muEncDone: { zh: "完成", en: "Done" },
};

export function t(key, vars) {
  let s = TR[key]?.[LANG] ?? key;
  if (vars) for (const k in vars) s = s.split(`{${k}}`).join(String(vars[k]));
  return s;
}

export function applyI18n(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    const k = el.dataset.i18n; if (TR[k]) el.textContent = TR[k][LANG];
  });
  root.querySelectorAll("[data-i18n-html]").forEach((el) => {
    const k = el.dataset.i18nHtml; if (TR[k]) el.innerHTML = TR[k][LANG];
  });
  root.querySelectorAll("[data-i18n-title]").forEach((el) => {
    const k = el.dataset.i18nTitle; if (TR[k]) el.title = TR[k][LANG];
  });
  root.querySelectorAll("[data-i18n-ph]").forEach((el) => {
    const k = el.dataset.i18nPh; if (TR[k]) el.placeholder = TR[k][LANG];
  });
  document.documentElement.lang = LANG === "zh" ? "zh-CN" : "en";
}

// Music Studio's top bar has no .topbar-actions; inject the toggle into
// the pair widget area (left of the pair button) instead.
export function mountLangToggle() {
  const host = document.querySelector(".pair-widget") || document.querySelector(".topbar");
  if (!host) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn--ghost btn--sm lang-toggle";
  btn.textContent = TR.langToggle[LANG];
  btn.title = TR.langToggleTitle[LANG];
  btn.addEventListener("click", () => {
    try { localStorage.setItem("obr-suite/lang", LANG === "zh" ? "en" : "zh"); } catch {}
    location.reload();
  });
  host.insertBefore(btn, host.firstChild);
}
