import type { Language, SuiteState } from "../state";

/** Frequent controls first; detailed authoring help stays optional. */
export function renderFogSettings(s: SuiteState, lang: Language, gm: boolean, authoring: boolean): string {
  const zh = lang === "zh";
  const row = (key: string, label: string, description: string, on: boolean) =>
    `<div class="row"><div class="lbl">${label}<div class="desc">${description}</div></div>` +
    `<button class="tog ${on ? "on" : ""}" data-key="${key}" type="button" ${gm ? "" : "disabled"} aria-label="${label}" aria-pressed="${on}"></button></div>`;
  return `<h3>${zh ? "玩家视野" : "Player vision"}</h3>
    ${row("fogShareVision", zh ? "玩家共享视野" : "Share party vision", zh
      ? "关闭：各自使用自己的视野。开启：共享队伍成员已授权的视野，隐藏单位与 NPC 不会自动加入。"
      : "Off: use your own vision. On: share authorized party vision. Hidden units and NPCs are not automatically included.", s.fogShareVision)}
    ${row("fogFilled", zh ? "填充地图迷雾" : "Fill map with fog", zh
      ? "需要打开地图的迷雾填充，视野范围和墙壁遮挡才会显现。"
      : "Enable the scene's fog fill to see vision ranges and wall occlusion.", false)}
    <p>${zh
      ? "DM 右键单位 → <b>添加光源 / 光源设置</b>，设置范围和视野归属。已分配玩家的角色卡可自动识别；普通玩家自行创建的角色也可加入队伍视野。"
      : "GM: right-click a token → <b>Add Light / Light Settings</b> for range and vision ownership. Assigned character cards and ordinary player-created characters are recognized automatically."}</p>
    <details class="fog-light-options"><summary>${zh ? "照明与高级选项" : "Lighting and advanced options"}</summary>
      ${row("fogLightOcclusion", zh ? "遮挡视线外的照明" : "Occlude lights beyond sight", zh
        ? "没有无遮挡视线时隐藏其他灯光。关闭只改变照明显示，不会把 NPC 的视野共享给玩家。自动归属的环境光保留公开照明与视野；明确归属和私密角色设置优先。"
        : "Hide other lights without an unobstructed sight line. Turning this off does not grant NPC vision. Automatic ambient lights retain public lighting and vision; explicit ownership and private-card settings take precedence.", s.fogLightOcclusion)}
      <p>${zh
        ? "主光源和辅助光源需要视野授权；次光源只照亮已经可见的区域。视野归属中的自动选项会随共享开关切换为所属玩家或全部玩家；也可指定玩家或仅 DM。角色卡详情的私密设置不影响共享视野。离线成员的普通视野暂不共享，重连后恢复。"
        : "Primary and auxiliary lights require vision permission. Secondary lights illuminate already visible areas. Automatic ownership uses the owning player with sharing off, or all players with sharing on. The GM can also assign a player or reserve a light for GMs. Private card details stay private when vision is shared. Offline-player vision leaves the pool until they reconnect."}</p>
      ${authoring ? row("fogPlayerDoors", zh ? "玩家可以开关门窗" : "Players can operate openings", zh
        ? "显示可操作的普通门窗；密门仍由 DM 管理。"
        : "Show player-operable doors and windows; secret doors remain GM-only.", s.fogPlayerDoors) +
        row("fogDoorOverlayAlways", zh ? "DM 常显门窗标记" : "Always show GM opening markers", zh
          ? "不选迷雾工具时也显示。" : "Keep markers visible without selecting the fog tool.", s.fogDoorOverlayAlways) : ""}
    </details>
    <details class="fog-authoring-help"><summary>${zh ? "墙壁与使用帮助" : "Walls and setup help"}</summary>
      <p>${zh
        ? "FOG 图层的图形和地图迷雾编辑器保存的轮廓会生成原生墙壁。墙壁遮挡视线，不限制单位移动。"
        : "FOG-layer drawings and map-fog-editor outlines become native walls. Walls block vision, not token movement."}</p>
      <p>${authoring ? (zh
        ? "迷雾工具中可画直线墙和门窗：O 普通门、I 窗户、U 密门；沿墙拖动放置，点击开关，Alt+点击或双击删除。窗户开关都可以看穿。"
        : "Use the fog tool to draw straight walls and openings: O for doors, I for windows, U for secret doors. Drag along a wall to place, click to toggle, Alt-click or double-click to remove. Windows remain see-through in both states.") : (zh
        ? "本频道可使用地图迷雾编辑器、墙壁遮挡和光源。额外的门窗绘制与操作工具目前由测试频道提供。"
        : "This channel supports the map fog editor, walls and lights. Additional opening-authoring tools are currently available in the dev channel.")}</p>
      <p>${zh
        ? "同一房间只启用一份迷雾引擎：套件与官方 Dynamic Fog 同时运行会重复生成墙和灯。稳定版与测试版也不要同时安装；两者共用房间设置和场景数据。"
        : "Use one fog engine per room. Running the suite alongside official Dynamic Fog duplicates walls and lights. Install either the stable or dev suite in a room; both use the same scene data and settings."}</p>
    </details>${gm ? "" : `<p class="role-notice">${zh ? "房间规则由 DM 设置" : "Room rules are set by the GM"}</p>`}`;
}
