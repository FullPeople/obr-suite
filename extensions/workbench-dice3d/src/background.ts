import OBR from '@owlbear-rodeo/sdk';
import {Controller} from './controller';
import {BUILD,CHANNEL,url} from './types';
import {normalizePlayerColor} from './player-color.mjs';
OBR.onReady(async()=>{
  try{
    const [id,name,roomColor,role]=await Promise.all([OBR.player.getConnectionId(),OBR.player.getName(),OBR.player.getColor(),OBR.player.getRole()]);
    const color=normalizePlayerColor(roomColor);
    const controller=new Controller({id,name,color,role,resolveRole:async connectionId=>(await OBR.party.getPlayers()).find(p=>p.connectionId===connectionId)?.role,mode:'Owlbear 实际广播',send:async data=>{await OBR.broadcast.sendMessage(CHANNEL,data,{destination:'REMOTE'})},listen:fn=>OBR.broadcast.onMessage(CHANNEL,e=>fn(e.data,e.connectionId))});
    OBR.player.onChange(player=>{if(player.connectionId!==id){controller.fail('connection-changed','连接身份已变化，请停用后重新启用测试插件');return}
      void controller.setProfile(player.name,player.color,player.role).catch(error=>controller.fail('player-change',error));
    });
    await controller.init();
    await OBR.modal.open({id:CHANNEL+'/overlay',url:url(`overlay.html?client=${encodeURIComponent(id)}&v=${BUILD}`),fullScreen:true,hideBackdrop:true,hidePaper:true,disablePointerEvents:true});
  }catch(error){console.error('[DiceLab] startup failed',error);await OBR.notification.show('Dice Lab 启动失败：'+String(error),'ERROR')}
});
