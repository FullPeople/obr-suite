import OBR from '@owlbear-rodeo/sdk';
import '../../../../src/modules/threeDragonAnte/page';
// The embedded view closes through its existing parent bridge. The historical
// controller remains in the background, so closing the view does not end play.
if(location.pathname.endsWith('/workbench-panels/table.html')){
 document.getElementById('close')?.addEventListener('click',event=>{event.stopImmediatePropagation();void OBR.modal.close('historical-table-view');},{capture:true});
 const display=document.getElementById('display-mode');if(display)display.hidden=true;
}
