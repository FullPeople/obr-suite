import {setupWorkbench} from '../src/workbench/background';
import {setupDice} from '../src/modules/dice';
setupWorkbench();void setupDice();

import {setupTimeStop} from '../src/modules/timeStop';
import {setupTransitions} from '../src/modules/transitions';
void setupTimeStop();void setupTransitions();
