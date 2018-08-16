import * as utils from './utils.js';

import {NROM} from './mappers/nrom.js';   // Mapper 0
import {MMC1} from './mappers/mmc1.js';   // Mapper 1
import {UxROM} from './mappers/uxrom.js'; // Mapper 2
import {CNROM} from './mappers/cnrom.js'; // Mapper 3
import {MMC3} from './mappers/mmc3.js';   // Mapper 4
import {MMC5} from './mappers/mmc5.js';   // Mapper 5
import {AxROM} from './mappers/axrom.js'; // Mapper 7
import {ColorDreams} from './mappers/colordreams.js'; // Mapper 11
import {BNROM} from './mappers/bnrom.js'; // Mapper 34
import {GxROM} from './mappers/gxrom.js'; // Mapper 66

export const Mappers = {
   0: NROM,
   1: MMC1,
   2: UxROM,
   3: CNROM,
   4: MMC3,
   5: MMC5,
   7: AxROM,
  11: ColorDreams,
  34: BNROM,
  66: GxROM,
};
