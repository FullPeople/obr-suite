import OBR from '@owlbear-rodeo/sdk';
import {mountPlayerPermissionNotice} from '../player-permission-notice';
import {workbenchPanelRequest} from './panel-sdk';

// The detached window and the Owlbear iframe can have partitioned storage.
// Commit in the same host bucket used by console/statusOnly, and await its ACK.
OBR.onReady(()=>{
 let language:'zh'|'en'='zh';
 try{if(localStorage.getItem('obr-suite/announce-lang')==='en')language='en';}catch{}
 mountPlayerPermissionNotice(language,()=>workbenchPanelRequest('permissions.acknowledge'));
});
