/** Temporary switch shared by the host, legacy panels and workbench frames. */
export const cloudFeaturesEnabled:boolean=false;
export const cloudDisabledMessage='云端功能和 QQ 登录暂不可用，已有资料会保留。';
export function assertCloudEnabled(){if(!cloudFeaturesEnabled)throw Object.assign(Error(cloudDisabledMessage),{code:'CLOUD_DISABLED',notSent:true,uncertain:false});}
