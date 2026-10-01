import {WORKBENCH_DEV} from './workbench/channel';

// Room metadata is shared between channels; public notices and acknowledgments
// are not. The dev body is generated from the paired Web suite release notes.
export const ANNOUNCEMENT_FILE = WORKBENCH_DEV ? 'announcement-dev.md' : 'announcement.md';
export const ANNOUNCEMENT_MODAL_ID = WORKBENCH_DEV ? 'com.obr-suite/workbench-announcement' : 'com.obr-suite/dm-announcement';
export const ANNOUNCEMENT_DAILY_KEY = WORKBENCH_DEV ? 'obr-suite/workbench/announce-daily-date' : 'obr-suite/announce-daily-date';
export const ANNOUNCEMENT_SEEN_KEY = WORKBENCH_DEV ? 'obr-suite/workbench/announce-seen-version' : 'obr-suite/announce-seen-version';
