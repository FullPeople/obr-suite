import { getLocalLang } from "../../state";
const strings = {
  title: ["音乐板", "Music"], noTrack: ["还没有播放的曲目", "Nothing playing"], paused: ["已暂停", "Paused"], playing: ["房间播放中", "Playing in room"],
  enable: ["启用声音", "Enable sound"], blocked: ["声音被浏览器拦截。允许此网站播放声音后重试。", "Sound is blocked. Allow sound for this site, then retry."],
  audioError: ["音源无法播放，请检查链接或换一首。", "This source cannot play. Check the link or choose another track."],
  play: ["播放", "Play"], pause: ["暂停", "Pause"], next: ["下一首", "Next"], stop: ["停止", "Stop"], loop: ["循环", "Loop"],
  localVolume: ["我的音量", "My volume"], mute: ["仅我静音", "Mute for me"], queue: ["接下来", "Up next"], noQueue: ["队列为空", "Queue is empty"],
  library: ["曲库与音效", "Library & sounds"], import: ["导入", "Import"], input: ["粘贴直链或音乐台分享码", "Paste direct links or a Studio share code"],
  defaults: ["浏览默认曲库", "Browse default library"], search: ["搜索曲名", "Search tracks"], add: ["加入曲库", "Add to library"],
  enqueue: ["加入队列", "Add to queue"], remove: ["移除", "Remove"], sounds: ["正在播放的音效", "Active sounds"], clearSfx: ["停止全部音效", "Stop all sounds"],
  studio: ["网页音乐台", "Music Studio"], openStudio: ["打开完整音乐台", "Open full Studio"], pairCode: ["6 位配对码", "6-character pairing code"],
  connect: ["连接", "Connect"], disconnect: ["断开", "Disconnect"], adopt: ["采用网页当前播放", "Use Studio playback"],
  disconnected: ["未连接", "Disconnected"], connecting: ["正在连接", "Connecting"], connected: ["已连接", "Connected"], reconnecting: ["正在重连，房间继续播放", "Reconnecting; room keeps playing"],
  restored: ["连接已恢复，已保留房间播放", "Reconnected; room playback preserved"], error: ["连接失败", "Connection failed"],
  studioHint: ["保留曲库、压缩、剪辑和配对。仅直链音源可共享；本地文件仍需先上传取得直链。关闭本面板不会停止后台音乐。", "Keeps the Studio library, encoding, trimming and pairing. Shared playback needs direct URLs; local files still need uploading first. Closing this panel keeps background music playing."],
  allow: ["允许所有玩家控制音乐", "Let all players control music"], readOnly: ["DM 已关闭玩家控制；我的音量仍可调整。", "The GM disabled player controls. Your own volume remains available."],
  close: ["关闭面板，继续播放", "Close panel; keep playing"], minimize: ["收起", "Minimize"], expand: ["展开音乐板", "Expand music"], drag: ["拖动音乐板", "Move music panel"],
  loading: ["正在读取…", "Loading…"], failed: ["操作失败，请重试。", "Operation failed. Please retry."], unavailable: ["音乐后台尚未就绪。", "Music background is not ready."],
  noWriter: ["控制请求未获确认，请稍后重试。", "Control request was not acknowledged. Retry shortly."], permission: ["你当前没有共享音乐控制权限。", "You do not currently have shared music control permission."],
  stalePlayback: ["房间已切换曲目，请对当前曲目重试。", "The room track changed. Retry on the current track."],
  invalidTrack: ["需要有效直链或音乐台分享码；本地文件地址不能共享。", "Use a valid direct URL or Studio share code; local file URLs cannot be shared."],
  invalidCommand: ["此操作不可用。", "This action is unavailable."], libraryFull: ["房间曲库最多 32 首，或导入内容过大。请分批导入。", "Room library allows 32 tracks; this import may also be too large. Import fewer tracks."],
  queueFull: ["队列最多 32 首。", "Queue allows up to 32 tracks."], roomFull: ["房间存储空间不足；现有曲库未改动。", "Room storage is full; the existing library was kept."],
  sceneUnavailable: ["场景正在切换或尚未打开，请在场景就绪后重试。", "The scene is changing or not open. Retry once it is ready."],
  sourceLimit: ["默认曲库仅在此浏览；点击曲目加入房间，不会一次写入所有曲目。", "Browse defaults here and add individual tracks to the room."],
} as const;
export function mt(key: keyof typeof strings): string { return strings[key][getLocalLang() === "en" ? 1 : 0]; }
export function musicError(error: unknown): string { const key = error instanceof Error ? error.message : String(error); return key in strings ? mt(key as keyof typeof strings) : mt("failed"); }
