import { publishWorkbenchNotice, setupWorkbenchNotices } from '../src/workbench/notices';
setupWorkbenchNotices();
Object.assign(window, { publishNotice: publishWorkbenchNotice });
