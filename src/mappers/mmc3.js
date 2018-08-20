import {NROM} from './nrom.js';

// Mapper 4: MMC3 and MMC6
export class MMC3 extends NROM {
  constructor(nes) {
    super(nes);

    this.CMD_SEL_2_1K_VROM_0000 = 0;
    this.CMD_SEL_2_1K_VROM_0800 = 1;
    this.CMD_SEL_1K_VROM_1000 = 2;
    this.CMD_SEL_1K_VROM_1400 = 3;
    this.CMD_SEL_1K_VROM_1800 = 4;
    this.CMD_SEL_1K_VROM_1C00 = 5;
    this.CMD_SEL_ROM_PAGE1 = 6;
    this.CMD_SEL_ROM_PAGE2 = 7;

    this.command = null;
    this.prgAddressSelect = null;
    this.chrAddressSelect = null;
    this.pageNumber = null;
    this.irqCounter = null;
    this.irqLatchValue = null;
    this.irqEnable = null;
    this.prgAddressChanged = false;
  }

  initializePrgRom() {
    


    this.addRomBank(0x8000, 0xa000, this.nes.rom.prgPage(0, 0x2000));
    this.addRomBank(0xa000, 0xc000, this.nes.rom.prgPage(1, 0x2000));
    this.addRomBank(0xc000, 0xe000, this.nes.rom.prgPage(-2, 0x2000));
    this.addRomBank(0xe000, 0x10000, this.nes.rom.prgPage(-1, 0x2000));
  }

  initializePatternTableBanks() {
    for (let i = 0; i < 0x2000; i += 0x400) {
      this.addVramBank(i, i + 0x400);
    }
  }

  initializePatternTables() {
    const vromCount = this.nes.rom.vromCount(0x400);
    if (vromCount > 0) {
      for (let i = 0; i < 8; i++) {
        this.loadChrPage(i << 12, i % vromCount, 0x0400);
      }
    }
  }

  initializeRegisters() {
    super.initializeRegisters();
    this.addRegisterBank('w', 0x8000, 0xa000, 2);
    this.addRegisterBank('w', 0xa000, 0xc000, 2);
    this.addRegisterBank('w', 0xc000, 0xe000, 2);
    this.addRegisterBank('w', 0xe000, 0x10000, 2);

    this.onWrite(0x8000, (value) => {
      // Command/Address Select register
      this.command = value & 7;
      var tmp = (value >> 6) & 1;
      if (tmp !== this.prgAddressSelect) {
        this.prgAddressChanged = true;
      }
      this.prgAddressSelect = tmp;
      this.chrAddressSelect = (value >> 7) & 1;
    });

    this.onWrite(0x8001, (value) => {
      // Page number for command
      this.executeCommand(this.command, value);
    });

    this.onWrite(0xa000, (value) => {
      // Mirroring select
      if ((value & 1) !== 0) {
        this.nes.ppu.setMirroring(this.nes.rom.HORIZONTAL_MIRRORING);
      } else {
        this.nes.ppu.setMirroring(this.nes.rom.VERTICAL_MIRRORING);
      }
    });

    this.onWrite(0xa001, (value) => {
      // SaveRAM Toggle
      // TODO
      //nes.getRom().setSaveState((value&1)!=0);
    });

    this.onWrite(0xc000, (value) => {
      // IRQ Counter register
      this.irqCounter = value;
      //nes.ppu.mapperIrqCounter = 0;
    });

    this.onWrite(0xc001, (value) => {
      // IRQ Latch register
      this.irqLatchValue = value;
    });

    this.onWrite(0xe000, (value) => {
      // IRQ Control Reg 0 (disable)
      //irqCounter = irqLatchValue;
      this.irqEnable = 0;
    });

    this.onWrite(0xe001, (value) => {
      // IRQ Control Reg 1 (enable)
      this.irqEnable = 1;
    });
  }

  executeCommand(cmd, arg) {
    switch (cmd) {
    case this.CMD_SEL_2_1K_VROM_0000:
      // Select 2 1KB VROM pages at 0x0000:
      if (this.chrAddressSelect === 0) {
        this.loadChrPage(0x0000, arg, 0x400);
        this.loadChrPage(0x0400, arg + 1, 0x400);
      } else {
        this.loadChrPage(0x1000, arg, 0x400);
        this.loadChrPage(0x1400, arg + 1, 0x400);
      }
      break;

    case this.CMD_SEL_2_1K_VROM_0800:
      // Select 2 1KB VROM pages at 0x0800:
      if (this.chrAddressSelect === 0) {
        this.loadChrPage(0x0800, arg, 0x400);
        this.loadChrPage(0x0c00, arg + 1, 0x400);
      } else {
        this.loadChrPage(0x1800, arg, 0x400);
        this.loadChrPage(0x1c00, arg + 1, 0x400);
      }
      break;

    case this.CMD_SEL_1K_VROM_1000:
      // Select 1K VROM Page at 0x1000:
      if (this.chrAddressSelect === 0) {
        this.loadChrPage(0x1000, arg, 0x400);
      } else {
        this.loadChrPage(0x0000, arg, 0x400);
      }
      break;

    case this.CMD_SEL_1K_VROM_1400:
      // Select 1K VROM Page at 0x1400:
      if (this.chrAddressSelect === 0) {
        this.loadChrPage(0x1400, arg, 0x400);
      } else {
        this.loadChrPage(0x400, arg, 0x400);
      }
      break;

    case this.CMD_SEL_1K_VROM_1800:
      // Select 1K VROM Page at 0x1800:
      if (this.chrAddressSelect === 0) {
        this.loadChrPage(0x1800, arg, 0x400);
      } else {
        this.loadChrPage(0x0800, arg, 0x400);
      }
      break;

    case this.CMD_SEL_1K_VROM_1C00:
      // Select 1K VROM Page at 0x1C00:
      if (this.chrAddressSelect === 0) {
        this.loadChrPage(0x1c00, arg, 0x400);
      } else {
        this.loadChrPage(0x0c00, arg, 0x400);
      }
      break;

    case this.CMD_SEL_ROM_PAGE1:
      if (this.prgAddressChanged) {
        // Load the two hardwired banks:
        if (this.prgAddressSelect === 0) {
          this.loadPrgPage(0xc000, -2, 0x2000);
        } else {
          this.loadPrgPage(0x8000, -2, 0x2000);
        }
        this.prgAddressChanged = false;
      }

      // Select first switchable ROM page:
      if (this.prgAddressSelect === 0) {
        this.loadPrgPage(0x8000, arg, 0x2000);
      } else {
        this.loadPrgPage(0xc000, arg, 0x2000);
      }
      break;

    case this.CMD_SEL_ROM_PAGE2:
      // Select second switchable ROM page:
      this.loadPrgPage(0xa000, arg, 0x2000);

      // hardwire appropriate bank:
      if (this.prgAddressChanged) {
        // Load the two hardwired banks:
        if (this.prgAddressSelect === 0) {
          this.loadPrgPage(0xc000, -2, 0x2000);
        } else {
          this.loadPrgPage(0x8000, -2, 0x2000);
        }
        this.prgAddressChanged = false;
      }
    }
  }

  clockIrqCounter() {
    if (this.irqEnable === 1) {
      this.irqCounter--;
      if (this.irqCounter < 0) {
        // Trigger IRQ:
        //nes.getCpu().doIrq();
        this.nes.cpu.requestIrq(this.nes.cpu.IRQ_NORMAL);
        this.irqCounter = this.irqLatchValue;
      }
    }
  }

  toJSON() {
    var s = super.toJSON();
    s.command = this.command;
    s.prgAddressSelect = this.prgAddressSelect;
    s.chrAddressSelect = this.chrAddressSelect;
    s.pageNumber = this.pageNumber;
    s.irqCounter = this.irqCounter;
    s.irqLatchValue = this.irqLatchValue;
    s.irqEnable = this.irqEnable;
    s.prgAddressChanged = this.prgAddressChanged;
    return s;
  }

  fromJSON(s) {
    super.fromJSON(s);
    this.command = s.command;
    this.prgAddressSelect = s.prgAddressSelect;
    this.chrAddressSelect = s.chrAddressSelect;
    this.pageNumber = s.pageNumber;
    this.irqCounter = s.irqCounter;
    this.irqLatchValue = s.irqLatchValue;
    this.irqEnable = s.irqEnable;
    this.prgAddressChanged = s.prgAddressChanged;
  }
}
