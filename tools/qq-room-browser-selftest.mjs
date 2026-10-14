import {cloudFeaturesEnabled} from '../src/cloud-availability.ts';
if(cloudFeaturesEnabled)await import('./qq-native-browser-selftest.mjs');else await import('./cloud-suspended-selftest.mjs');
