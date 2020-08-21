 import * as utils from './utils.js';
import {Debug} from './debug.js';
import {Savestate} from './wire.js';
import {Recorder} from './movie.js';
import {opdata} from './opdata.js';

export function CPU(nes) {
  this.nes = nes;

  // Keep Chrome happy
  this.ram = null;
  this.REG_ACC = null;
  this.REG_X = null;
  this.REG_Y = null;
  this.REG_SP = null;
  this.REG_PC = null;
  this.REG_PC_NEW = null;
  this.F_CARRY = null;
  this.F_DECIMAL = null;
  this.F_INTERRUPT = null;
  this.F_INTERRUPT_NEW = null;
  this.F_OVERFLOW = null;
  this.F_SIGN = null;
  this.F_NONZERO = null;
  this.F_NOTUSED = null;
  this.F_NOTUSED_NEW = null;
  this.F_BRK = null;
  this.F_BRK_NEW = null;
  this.cyclesToHalt = null;
  this.crash = null;
  this.irq = null; // pending interrupt type

  this.reset();
};

CPU.prototype = {
  // IRQ Types
  IRQ_NORMAL: 1,
  IRQ_NMI: 2,
  IRQ_RESET: 3,

  writeSavestate: function() {
    return Savestate.Cpu.of({
      ram:  this.ram,
      a:    this.REG_ACC,
      x:    this.REG_X,
      y:    this.REG_Y,
      sp:   this.REG_SP,
      f:    this.getStatus(),
      irq:  this.irq,
      pc:   this.REG_PC,
      halt: this.cyclesToHalt,
      // TODO - cyclesToHalt ?
      // TODO(sdh): worth saving crash?
      // What about recording status/history?
    });
  },

  restoreSavestate: function(cpu) {
    this.ram.set(new Uint8Array(cpu.ram));
    this.REG_ACC = cpu.a;
    this.REG_X = cpu.x;
    this.REG_Y = cpu.y;
    this.REG_SP = cpu.sp;
    this.setStatus(cpu.f);
    this.irq = cpu.irq;
    this.REG_PC = cpu.pc;
    this.cyclesToHalt = cpu.halt;
  },

  reset: function() {
    this.ram = new Uint8Array(0x800).fill(0xff);
    this.ram[0x8] = 0xf7;
    this.ram[0x9] = 0xef;
    this.ram[0xa] = 0xdf;
    this.ram[0xf] = 0xbf;
    // CPU Registers:
    this.REG_ACC = 0;
    this.REG_X = 0;
    this.REG_Y = 0;
    // Reset Stack pointer:
    this.REG_SP = 0x01ff;
    // Reset Program counter:
    this.REG_PC = 0x8000 - 1;
    this.REG_PC_NEW = 0x8000 - 1;

    this.setStatus(0x28);

    // Set flags:
    this.F_CARRY = 0;
    this.F_DECIMAL = 0;
    this.F_INTERRUPT = 1;
    this.F_INTERRUPT_NEW = 1;
    this.F_OVERFLOW = 0;
    this.F_SIGN = 0;
    this.F_NONZERO = 0;

    this.F_NOTUSED = 1;
    this.F_NOTUSED_NEW = 1;
    this.F_BRK = 1;
    this.F_BRK_NEW = 1;

    this.cyclesToHalt = 0;

    // Reset crash flag:
    this.crash = null;

    // Interrupt notification:
    this.irq = 0;
  },

  softReset() {
    this.REG_PC = this.load16bit(0xfffc) - 1;
    // TODO - this.requestIrq(IRQ_RESET) ---> ?
    if (this.nes.movie instanceof Recorder) {
      this.nes.movie.record({reset: true});
    }
  },

  // Emulates a single CPU instruction, returns the number of cycles
  emulate: function() {
    var temp, temp2;
    var add;
    var cycleCount = 0;

    // Check interrupts:
    if (this.irq) {
      temp =
        this.F_CARRY |
        (this.F_NONZERO ? 0 : 2) |
        (this.F_INTERRUPT << 2) |
        (this.F_DECIMAL << 3) |
        (this.F_BRK << 4) |
        (this.F_NOTUSED << 5) |
        (this.F_OVERFLOW << 6) |
        (this.F_SIGN << 7);

      this.REG_PC_NEW = this.REG_PC;
      this.F_INTERRUPT_NEW = this.F_INTERRUPT;
      switch (this.irq) {
        case 1: {
          // Normal IRQ:
          if (this.F_INTERRUPT !== 0) {
            // console.log("Interrupt was masked.");
            temp = -1; // leave the request in place.
            break;
          }
          this.doIrq(temp);
          // console.log("Did normal IRQ. I="+this.F_INTERRUPT);
          break;
        }
        case 2: {
          // NMI:
          this.doNonMaskableInterrupt(temp);
          break;
        }
        case 3: {
          // Reset:
          this.doResetInterrupt();
          break;
        }
      }

      if (temp >= 0) {
        cycleCount = 7;
        this.REG_PC = this.REG_PC_NEW;
        this.F_INTERRUPT = this.F_INTERRUPT_NEW;
        this.F_BRK = this.F_BRK_NEW;
        this.irq = 0;
      }
    }

    var opcode = this.load(this.REG_PC + 1);
    var opinf = opdata[opcode];
    cycleCount += opinf >> 24;
    var cycleAdd = 0;

    // Find address mode:
    var addrMode = (opinf >> 8) & 0xff;

    // Increment PC by number of op bytes:
    var opaddr = this.REG_PC;
    this.REG_PC += (opinf >> 16) & 0xff;

    if (this.nes.debug) this.nes.debug.logCpu(opcode, opaddr + 1);

    var logmem = false;
    var addr = 0;
    switch (addrMode) {
      case 0: {
        // Zero Page mode. Use the address given after the opcode,
        // but without high byte.
        addr = this.load(opaddr + 2);
        logmem = true;
        break;
      }
      case 1: {
        // Relative mode.
        addr = this.load(opaddr + 2);
        if (addr < 0x80) {
          addr += this.REG_PC;
        } else {
          addr += this.REG_PC - 256;
        }
        break;
      }
      case 2: {
        // Ignore. Address is implied in instruction.
        break;
      }
      case 3: {
        // Absolute mode. Use the two bytes following the opcode as
        // an address.
        addr = this.load16bit(opaddr + 2);
        logmem = true;
        break;
      }
      case 4: {
        // Accumulator mode. The address is in the accumulator
        // register.
        addr = this.REG_ACC;
        break;
      }
      case 5: {
        // Immediate mode. The value is given after the opcode.
        addr = this.REG_PC;
        break;
      }
      case 6: {
        // Zero Page Indexed mode, X as index. Use the address given
        // after the opcode, then add the
        // X register to it to get the final address.
        addr = (this.load(opaddr + 2) + this.REG_X) & 0xff;
        logmem = true;
        break;
      }
      case 7: {
        // Zero Page Indexed mode, Y as index. Use the address given
        // after the opcode, then add the
        // Y register to it to get the final address.
        addr = (this.load(opaddr + 2) + this.REG_Y) & 0xff;
        logmem = true;
        break;
      }
      case 8: {
        // Absolute Indexed Mode, X as index. Same as zero page
        // indexed, but with the high byte.
        addr = this.load16bit(opaddr + 2);
        if ((addr & 0xff00) !== ((addr + this.REG_X) & 0xff00)) {
          cycleAdd = 1;
        }
        if (this.nes.debug && this.nes.debug.cdl) this.nes.debug.cdl.logIndex('x');
        addr += this.REG_X;
        logmem = true;
        break;
      }
      case 9: {
        // Absolute Indexed Mode, Y as index. Same as zero page
        // indexed, but with the high byte.
        addr = this.load16bit(opaddr + 2);
        if ((addr & 0xff00) !== ((addr + this.REG_Y) & 0xff00)) {
          cycleAdd = 1;
        }
        if (this.nes.debug && this.nes.debug.cdl) this.nes.debug.cdl.logIndex('y');
        addr += this.REG_Y;
        logmem = true;
        break;
      }
      case 10: {
        // Pre-indexed Indirect mode. Find the 16-bit address
        // starting at the given location plus
        // the current X register. The value is the contents of that
        // address.
        addr = this.load(opaddr + 2);
        // NOTE(sdh): this mode does not actually have variable cycles.
        // if ((addr & 0xff00) !== ((addr + this.REG_X) & 0xff00)) {
        //   cycleAdd = 1;
        // }
        addr += this.REG_X;
        addr &= 0xff;
        if (this.nes.debug && this.nes.debug.cdl) this.nes.debug.cdl.logIndirect(addr, 'x');
        addr = this.load16bit(addr, true);
        logmem = true;
        break;
      }
      case 11: {
        // Post-indexed Indirect mode. Find the 16-bit address
        // contained in the given location
        // (and the one following). Add to that address the contents
        // of the Y register. Fetch the value
        // stored at that adress.
        const first = this.load(opaddr + 2);
        if (this.nes.debug && this.nes.debug.cdl) this.nes.debug.cdl.logIndirect(first, 'y');
        addr = this.load16bit(first, true);
        if ((addr & 0xff00) !== ((addr + this.REG_Y) & 0xff00)) {
          cycleAdd = 1;
        }
        addr += this.REG_Y;
        logmem = true;
        break;
      }
      case 12: {
        // Indirect Absolute mode. Find the 16-bit address contained
        // at the given location.
        const a = this.load16bit(opaddr + 2); // Find op
        //if (this.nes.debug && this.nes.debug.cdl) this.nes.debug.cdl.logIndirectJump(a);
        // Read from address given in op
        addr = this.load(a) + (this.load((a & 0xff00) | (((a & 0xff) + 1) & 0xff)) << 8);
        if (this.nes.debug) this.nes.debug.logMem(Debug.MEM_RD16, a, addr);
        logmem = true;
        break;
      }
    }
    // Wrap around for addresses above 0xFFFF:
    addr &= 0xffff;

    // ----------------------------------------------------------------------------------------------------
    // Decode & execute instruction:
    // ----------------------------------------------------------------------------------------------------

    // This should be compiled to a jump table.
    switch (opinf & 0xff) {
      case 0: {
        // *******
        // * ADC *
        // *******

        // Add with carry.
        temp2 = this.load(addr, logmem);
        temp = this.REG_ACC + temp2 + this.F_CARRY;

        if (
          ((this.REG_ACC ^ temp2) & 0x80) === 0 &&
          ((this.REG_ACC ^ temp) & 0x80) !== 0
        ) {
          this.F_OVERFLOW = 1;
        } else {
          this.F_OVERFLOW = 0;
        }
        this.F_CARRY = temp > 255 ? 1 : 0;
        this.F_SIGN = (temp >> 7) & 1;
        this.F_NONZERO = temp & 0xff;
        this.REG_ACC = temp & 255;
        cycleCount += cycleAdd;
        break;
      }
      case 1: {
        // *******
        // * AND *
        // *******

        // AND memory with accumulator.
        this.REG_ACC = this.REG_ACC & this.load(addr, logmem);
        this.F_SIGN = (this.REG_ACC >> 7) & 1;
        this.F_NONZERO = this.REG_ACC;
        //this.REG_ACC = temp;
        if (addrMode !== 11) cycleCount += cycleAdd; // PostIdxInd = 11
        break;
      }
      case 2: {
        // *******
        // * ASL *
        // *******

        // Shift left one bit
        if (addrMode === 4) {
          // ADDR_ACC = 4

          this.F_CARRY = (this.REG_ACC >> 7) & 1;
          this.REG_ACC = (this.REG_ACC << 1) & 255;
          this.F_SIGN = (this.REG_ACC >> 7) & 1;
          this.F_NONZERO = this.REG_ACC;
        } else {
          temp2 = this.load(addr);
          this.F_CARRY = (temp2 >> 7) & 1;
          temp = (temp2 << 1) & 255;
          this.F_SIGN = (temp >> 7) & 1;
          this.F_NONZERO = temp;
          this.write(addr, temp);
          if (logmem) this.nes.debug.logMem(Debug.MEM_RW, addr, temp2, temp);
        }
        break;
      }
      case 3: {
        // *******
        // * BCC *
        // *******

        // Branch on carry clear
        if (!this.F_CARRY) {
          cycleCount += (opaddr & 0xff00) !== (addr & 0xff00) ? 2 : 1;
          this.REG_PC = addr;
          if (this.nes.debug) this.nes.debug.logJmp();
        }
        break;
      }
      case 4: {
        // *******
        // * BCS *
        // *******

        // Branch on carry set
        if (this.F_CARRY) {
          cycleCount += (opaddr & 0xff00) !== (addr & 0xff00) ? 2 : 1;
          this.REG_PC = addr;
          if (this.nes.debug) this.nes.debug.logJmp();
        }
        break;
      }
      case 5: {
        // *******
        // * BEQ *
        // *******

        // Branch on zero
        if (!this.F_NONZERO) {
          cycleCount += (opaddr & 0xff00) !== (addr & 0xff00) ? 2 : 1;
          this.REG_PC = addr;
          if (this.nes.debug) this.nes.debug.logJmp();
        }
        break;
      }
      case 6: {
        // *******
        // * BIT *
        // *******

        // Test bits against A
        temp = this.load(addr, logmem);
        this.F_SIGN = (temp >> 7) & 1;
        this.F_OVERFLOW = (temp >> 6) & 1;
        temp &= this.REG_ACC;
        this.F_NONZERO = temp;
        break;
      }
      case 7: {
        // *******
        // * BMI *
        // *******

        // Branch on negative result
        if (this.F_SIGN) {
          cycleCount++;
          this.REG_PC = addr;
          if (this.nes.debug) this.nes.debug.logJmp();
        }
        break;
      }
      case 8: {
        // *******
        // * BNE *
        // *******

        // Branch on not zero
        if (this.F_NONZERO) {
          cycleCount += (opaddr & 0xff00) !== (addr & 0xff00) ? 2 : 1;
          this.REG_PC = addr;
          if (this.nes.debug) this.nes.debug.logJmp();
        }
        break;
      }
      case 9: {
        // *******
        // * BPL *
        // *******

        // Branch on positive result
        if (this.F_SIGN === 0) {
          cycleCount += (opaddr & 0xff00) !== (addr & 0xff00) ? 2 : 1;
          this.REG_PC = addr;
          if (this.nes.debug) this.nes.debug.logJmp();
        }
        break;
      }
      case 10: {
        // *******
        // * BRK *
        // *******

        this.REG_PC += 2;
        this.push((this.REG_PC >> 8) & 255);
        this.push(this.REG_PC & 255);
        this.F_BRK = 1;

        this.push(
          this.F_CARRY |
            (this.F_NONZERO ? 0 : 2) |
            (this.F_INTERRUPT << 2) |
            (this.F_DECIMAL << 3) |
            (this.F_BRK << 4) |
            (this.F_NOTUSED << 5) |
            (this.F_OVERFLOW << 6) |
            (this.F_SIGN << 7)
        );

        this.F_INTERRUPT = 1;
        //this.REG_PC = load(0xFFFE) | (load(0xFFFF) << 8);
        this.REG_PC = this.load16bit(0xfffe);
        this.REG_PC--;
        break;
      }
      case 11: {
        // *******
        // * BVC *
        // *******

        // Branch on overflow clear
        if (this.F_OVERFLOW === 0) {
          cycleCount += (opaddr & 0xff00) !== (addr & 0xff00) ? 2 : 1;
          this.REG_PC = addr;
          if (this.nes.debug) this.nes.debug.logJmp();
        }
        break;
      }
      case 12: {
        // *******
        // * BVS *
        // *******

        // Branch on overflow set
        if (this.F_OVERFLOW === 1) {
          cycleCount += (opaddr & 0xff00) !== (addr & 0xff00) ? 2 : 1;
          this.REG_PC = addr;
          if (this.nes.debug) this.nes.debug.logJmp();
        }
        break;
      }
      case 13: {
        // *******
        // * CLC *
        // *******

        // Clear carry flag
        this.F_CARRY = 0;
        break;
      }
      case 14: {
        // *******
        // * CLD *
        // *******

        // Clear decimal flag
        this.F_DECIMAL = 0;
        break;
      }
      case 15: {
        // *******
        // * CLI *
        // *******

        // Clear interrupt flag
        this.F_INTERRUPT = 0;
        break;
      }
      case 16: {
        // *******
        // * CLV *
        // *******

        // Clear overflow flag
        this.F_OVERFLOW = 0;
        break;
      }
      case 17: {
        // *******
        // * CMP *
        // *******

        // Compare memory and accumulator:
        temp = this.REG_ACC - this.load(addr, logmem);
        this.F_CARRY = temp >= 0 ? 1 : 0;
        this.F_SIGN = (temp >> 7) & 1;
        this.F_NONZERO = temp & 0xff;
        cycleCount += cycleAdd;
        break;
      }
      case 18: {
        // *******
        // * CPX *
        // *******

        // Compare memory and index X:
        temp = this.REG_X - this.load(addr, logmem);
        this.F_CARRY = temp >= 0 ? 1 : 0;
        this.F_SIGN = (temp >> 7) & 1;
        this.F_NONZERO = temp & 0xff;
        break;
      }
      case 19: {
        // *******
        // * CPY *
        // *******

        // Compare memory and index Y:
        temp = this.REG_Y - this.load(addr, logmem);
        this.F_CARRY = temp >= 0 ? 1 : 0;
        this.F_SIGN = (temp >> 7) & 1;
        this.F_NONZERO = temp & 0xff;
        break;
      }
      case 20: {
        // *******
        // * DEC *
        // *******

        // Decrement memory by one:
        temp2 = this.load(addr);
        temp = (temp2 - 1) & 0xff;
        this.F_SIGN = (temp >> 7) & 1;
        this.F_NONZERO = temp;
        this.write(addr, temp);
        if (logmem) this.nes.debug.logMem(Debug.MEM_RW, addr, temp2, temp);
        break;
      }
      case 21: {
        // *******
        // * DEX *
        // *******

        // Decrement index X by one:
        this.REG_X = (this.REG_X - 1) & 0xff;
        this.F_SIGN = (this.REG_X >> 7) & 1;
        this.F_NONZERO = this.REG_X;
        break;
      }
      case 22: {
        // *******
        // * DEY *
        // *******

        // Decrement index Y by one:
        this.REG_Y = (this.REG_Y - 1) & 0xff;
        this.F_SIGN = (this.REG_Y >> 7) & 1;
        this.F_NONZERO = this.REG_Y;
        break;
      }
      case 23: {
        // *******
        // * EOR *
        // *******

        // XOR Memory with accumulator, store in accumulator:
        this.REG_ACC = (this.load(addr, logmem) ^ this.REG_ACC) & 0xff;
        this.F_SIGN = (this.REG_ACC >> 7) & 1;
        this.F_NONZERO = this.REG_ACC;
        cycleCount += cycleAdd;
        break;
      }
      case 24: {
        // *******
        // * INC *
        // *******

        // Increment memory by one:
        temp2 = this.load(addr)
        temp = (temp2 + 1) & 0xff;
        this.F_SIGN = (temp >> 7) & 1;
        this.F_NONZERO = temp;
        this.write(addr, temp & 0xff);
        if (logmem) this.nes.debug.logMem(Debug.MEM_RW, addr, temp2, temp);
        break;
      }
      case 25: {
        // *******
        // * INX *
        // *******

        // Increment index X by one:
        this.REG_X = (this.REG_X + 1) & 0xff;
        this.F_SIGN = (this.REG_X >> 7) & 1;
        this.F_NONZERO = this.REG_X;
        break;
      }
      case 26: {
        // *******
        // * INY *
        // *******

        // Increment index Y by one:
        this.REG_Y++;
        this.REG_Y &= 0xff;
        this.F_SIGN = (this.REG_Y >> 7) & 1;
        this.F_NONZERO = this.REG_Y;
        break;
      }
      case 27: {
        // *******
        // * JMP *
        // *******

        // Jump to new location:
        this.REG_PC = addr - 1;
        if (this.nes.debug) this.nes.debug.logJmp();
        break;
      }
      case 28: {
        // *******
        // * JSR *
        // *******

        // Jump to new location, saving return address.
        // Push return address on stack:
        this.push((this.REG_PC >> 8) & 255);
        this.push(this.REG_PC & 255);
        this.REG_PC = addr - 1;
        if (this.nes.debug) this.nes.debug.logJmp();
        break;
      }
      case 29: {
        // *******
        // * LDA *
        // *******

        // Load accumulator with memory:
        this.REG_ACC = this.load(addr, logmem);
        this.F_SIGN = (this.REG_ACC >> 7) & 1;
        this.F_NONZERO = this.REG_ACC;
        cycleCount += cycleAdd;
        break;
      }
      case 30: {
        // *******
        // * LDX *
        // *******

        // Load index X with memory:
        this.REG_X = this.load(addr, logmem);
        this.F_SIGN = (this.REG_X >> 7) & 1;
        this.F_NONZERO = this.REG_X;
        cycleCount += cycleAdd;
        break;
      }
      case 31: {
        // *******
        // * LDY *
        // *******

        // Load index Y with memory:
        this.REG_Y = this.load(addr, logmem);
        this.F_SIGN = (this.REG_Y >> 7) & 1;
        this.F_NONZERO = this.REG_Y;
        cycleCount += cycleAdd;
        break;
      }
      case 32: {
        // *******
        // * LSR *
        // *******

        // Shift right one bit:
        if (addrMode === 4) {
          // ADDR_ACC
          temp = this.REG_ACC & 0xff;
          this.F_CARRY = temp & 1;
          temp >>= 1;
          this.REG_ACC = temp;
        } else {
          temp2 = this.load(addr) & 0xff;
          this.F_CARRY = temp2 & 1;
          temp = temp2 >> 1;
          this.write(addr, temp);
          if (logmem) this.nes.debug.logMem(Debug.MEM_RW, addr, temp2, temp);
        }
        this.F_SIGN = 0;
        this.F_NONZERO = temp;
        break;
      }
      case 33: {
        // *******
        // * NOP *
        // *******

        // No OPeration.
        // Ignore.
        break;
      }
      case 34: {
        // *******
        // * ORA *
        // *******

        // OR memory with accumulator, store in accumulator.
        temp = (this.load(addr, logmem) | this.REG_ACC) & 255;
        this.F_SIGN = (temp >> 7) & 1;
        this.F_NONZERO = temp;
        this.REG_ACC = temp;
        if (addrMode !== 11) cycleCount += cycleAdd; // PostIdxInd = 11
        break;
      }
      case 35: {
        // *******
        // * PHA *
        // *******

        // Push accumulator on stack
        this.push(this.REG_ACC);
        break;
      }
      case 36: {
        // *******
        // * PHP *
        // *******

        // Push processor status on stack
        this.F_BRK = 1;
        this.push(
          this.F_CARRY |
            (this.F_NONZERO ? 0 : 2) |
            (this.F_INTERRUPT << 2) |
            (this.F_DECIMAL << 3) |
            (this.F_BRK << 4) |
            (this.F_NOTUSED << 5) |
            (this.F_OVERFLOW << 6) |
            (this.F_SIGN << 7)
        );
        break;
      }
      case 37: {
        // *******
        // * PLA *
        // *******

        // Pull accumulator from stack
        this.REG_ACC = this.pull();
        this.F_SIGN = (this.REG_ACC >> 7) & 1;
        this.F_NONZERO = this.REG_ACC;
        break;
      }
      case 38: {
        // *******
        // * PLP *
        // *******

        // Pull processor status from stack
        temp = this.pull();
        this.F_CARRY = temp & 1;
        this.F_NONZERO = temp & 2 ? 0 : 1;
        this.F_INTERRUPT = (temp >> 2) & 1;
        this.F_DECIMAL = (temp >> 3) & 1;
        this.F_BRK = (temp >> 4) & 1;
        this.F_NOTUSED = (temp >> 5) & 1;
        this.F_OVERFLOW = (temp >> 6) & 1;
        this.F_SIGN = (temp >> 7) & 1;

        this.F_NOTUSED = 1;
        break;
      }
      case 39: {
        // *******
        // * ROL *
        // *******

        // Rotate one bit left
        if (addrMode === 4) {
          // ADDR_ACC = 4
          temp = this.REG_ACC;
          add = this.F_CARRY;
          this.F_CARRY = (temp >> 7) & 1;
          temp = ((temp << 1) & 0xff) + add;
          this.REG_ACC = temp;
        } else {
          temp2 = this.load(addr);
          add = this.F_CARRY;
          this.F_CARRY = (temp2 >> 7) & 1;
          temp = ((temp2 << 1) & 0xff) + add;
          this.write(addr, temp);
          if (logmem) this.nes.debug.logMem(Debug.MEM_RW, addr, temp2, temp);
        }
        this.F_SIGN = (temp >> 7) & 1;
        this.F_NONZERO = temp;
        break;
      }
      case 40: {
        // *******
        // * ROR *
        // *******

        // Rotate one bit right
        if (addrMode === 4) {
          // ADDR_ACC = 4
          add = this.F_CARRY << 7;
          this.F_CARRY = this.REG_ACC & 1;
          temp = (this.REG_ACC >> 1) + add;
          this.REG_ACC = temp;
        } else {
          temp2 = this.load(addr);
          add = this.F_CARRY << 7;
          this.F_CARRY = temp2 & 1;
          temp = (temp2 >> 1) + add;
          this.write(addr, temp);
          if (logmem) this.nes.debug.logMem(Debug.MEM_RW, addr, temp2, temp);
        }
        this.F_SIGN = (temp >> 7) & 1;
        this.F_NONZERO = temp;
        break;
      }
      case 41: {
        // *******
        // * RTI *
        // *******

        // Return from interrupt. Pull status and PC from stack.
        temp = this.pull();
        this.F_CARRY = temp & 1;
        this.F_NONZERO = temp & 2 ? 0 : 1;
        this.F_INTERRUPT = (temp >> 2) & 1;
        this.F_DECIMAL = (temp >> 3) & 1;
        this.F_BRK = (temp >> 4) & 1;
        this.F_NOTUSED = (temp >> 5) & 1;
        this.F_OVERFLOW = (temp >> 6) & 1;
        this.F_SIGN = (temp >> 7) & 1;

        this.REG_PC = this.pull();
        this.REG_PC += this.pull() << 8;
        if (this.REG_PC === 0xffff) {
          return;
        }
        this.REG_PC--;
        this.F_NOTUSED = 1;
        break;
      }
      case 42: {
        // *******
        // * RTS *
        // *******

        // Return from subroutine. Pull PC from stack.

        this.REG_PC = this.pull();
        this.REG_PC += this.pull() << 8;

        if (this.REG_PC === 0xffff) {
          return; // return from NSF play routine:
        }
        break;
      }
      case 43: {
        // *******
        // * SBC *
        // *******

        const v = this.load(addr, logmem);
        temp = this.REG_ACC - v - (1 - this.F_CARRY);
        this.F_SIGN = (temp >> 7) & 1;
        this.F_NONZERO = temp & 0xff;
        if (
          ((this.REG_ACC ^ temp) & 0x80) !== 0 &&
          ((this.REG_ACC ^ v) & 0x80) !== 0
        ) {
          this.F_OVERFLOW = 1;
        } else {
          this.F_OVERFLOW = 0;
        }
        this.F_CARRY = temp < 0 ? 0 : 1;
        this.REG_ACC = temp & 0xff;
        if (addrMode !== 11) cycleCount += cycleAdd; // PostIdxInd = 11
        break;
      }
      case 44: {
        // *******
        // * SEC *
        // *******

        // Set carry flag
        this.F_CARRY = 1;
        break;
      }
      case 45: {
        // *******
        // * SED *
        // *******

        // Set decimal mode
        this.F_DECIMAL = 1;
        break;
      }
      case 46: {
        // *******
        // * SEI *
        // *******

        // Set interrupt disable status
        this.F_INTERRUPT = 1;
        break;
      }
      case 47: {
        // *******
        // * STA *
        // *******

        // Store accumulator in memory
        this.write(addr, this.REG_ACC);
        if (logmem) this.nes.debug.logMem(Debug.MEM_WR, addr, this.REG_ACC);
        break;
      }
      case 48: {
        // *******
        // * STX *
        // *******

        // Store index X in memory
        this.write(addr, this.REG_X);
        if (logmem) this.nes.debug.logMem(Debug.MEM_WR, addr, this.REG_X);
        break;
      }
      case 49: {
        // *******
        // * STY *
        // *******

        // Store index Y in memory:
        this.write(addr, this.REG_Y);
        if (logmem) this.nes.debug.logMem(Debug.MEM_WR, addr, this.REG_Y);
        break;
      }
      case 50: {
        // *******
        // * TAX *
        // *******

        // Transfer accumulator to index X:
        this.REG_X = this.REG_ACC;
        this.F_SIGN = (this.REG_ACC >> 7) & 1;
        this.F_NONZERO = this.REG_ACC;
        break;
      }
      case 51: {
        // *******
        // * TAY *
        // *******

        // Transfer accumulator to index Y:
        this.REG_Y = this.REG_ACC;
        this.F_SIGN = (this.REG_ACC >> 7) & 1;
        this.F_NONZERO = this.REG_ACC;
        break;
      }
      case 52: {
        // *******
        // * TSX *
        // *******

        // Transfer stack pointer to index X:
        this.REG_X = this.REG_SP & 0xff;
        this.F_SIGN = (this.REG_SP >> 7) & 1;
        this.F_NONZERO = this.REG_X;
        break;
      }
      case 53: {
        // *******
        // * TXA *
        // *******

        // Transfer index X to accumulator:
        this.REG_ACC = this.REG_X;
        this.F_SIGN = (this.REG_X >> 7) & 1;
        this.F_NONZERO = this.REG_X;
        break;
      }
      case 54: {
        // *******
        // * TXS *
        // *******

        // Transfer index X to stack pointer:
        if (this.nes.debug) {
          const delta = (this.REG_SP - this.REG_X) & 0xff;
          this.nes.debug.logStack(delta > 0x7f ? delta - 0x100 : delta);
        }
        this.REG_SP = (this.REG_X & 0xff) | 0x0100;
        break;
      }
      case 55: {
        // *******
        // * TYA *
        // *******

        // Transfer index Y to accumulator:
        this.REG_ACC = this.REG_Y;
        this.F_SIGN = (this.REG_Y >> 7) & 1;
        this.F_NONZERO = this.REG_Y;
        break;
      }
      default: {
        // *******
        // * ??? *
        // *******

        if (!this.nes.debug) this.nes.debug = new Debug(this.nes);
        this.nes.debug.break = true;
        this.nes.crashMessage =
          "Game crashed, invalid opcode at address $" + opaddr.toString(16);
        break;
      }
    } // end of switch

    return cycleCount;
  },

  load: function(addr, opt_log) {
    let result;
    result = addr < 0x2000 ? this.ram[addr & 0x7ff] : this.nes.mmap.load(addr);
    if (opt_log && this.nes.debug) this.nes.debug.logMem(Debug.MEM_RD, addr, result);
    return result;
  },

  load16bit: function(addr, opt_log) {
    const result = this.load(addr) | (this.load(addr + 1) << 8);
    if (opt_log && this.nes.debug) this.nes.debug.logMem(Debug.MEM_RD16, addr, result);
    return result;
  },

  write: function(addr, val, opt_log) {
    if (addr < 0x2000) {
      this.ram[addr & 0x7ff] = val;
    } else {
      this.nes.mmap.write(addr, val);
    }
    if (opt_log && this.nes.debug) this.nes.debug.logMem(Debug.MEM_WR, addr, val);
  },

  requestIrq: function(type) {
    if (this.irq) {
      if (type === this.IRQ_NORMAL) {
        return;
      }
      // console.log("too fast irqs. type="+type);
    }
    this.irq = type;
  },

  push: function(value) {
    this.ram[this.REG_SP] = value;
    if (this.nes.debug) {
      this.nes.debug.logMem(Debug.MEM_WR, this.REG_SP, value);
      this.nes.debug.logStack(1);
    }
    this.REG_SP--;
    this.REG_SP = 0x0100 | (this.REG_SP & 0xff);
  },

  pull: function() {
    this.REG_SP++;
    this.REG_SP = 0x0100 | (this.REG_SP & 0xff);
    const value = this.ram[this.REG_SP];
    if (this.nes.debug) {
      this.nes.debug.logMem(Debug.MEM_RD, this.REG_SP, value);
      this.nes.debug.logStack(-1);
    }
    return value;
  },

  haltCycles: function(cycles) {
    this.cyclesToHalt += cycles;
  },

  doNonMaskableInterrupt: function(status) {
    if ((this.load(0x2000) & 128) !== 0) {
      if (this.nes.debug) this.nes.debug.logInterrupt(Debug.NMI);
      // Check whether VBlank Interrupts are enabled

      this.REG_PC_NEW++;
      this.push((this.REG_PC_NEW >> 8) & 0xff);
      this.push(this.REG_PC_NEW & 0xff);
      //this.F_INTERRUPT_NEW = 1;
      this.push(status);

      this.REG_PC_NEW = this.load(0xfffa) | (this.load(0xfffb) << 8);
      this.REG_PC_NEW--;
    }
  },

  doResetInterrupt: function() {
    if (this.nes.debug) this.nes.debug.logInterrupt(Debug.RESET);
    this.REG_PC_NEW = this.load(0xfffc) | (this.load(0xfffd) << 8);
    this.REG_PC_NEW--;
  },

  doIrq: function(status) {
    if (this.nes.debug) this.nes.debug.logInterrupt(Debug.IRQ);
    this.REG_PC_NEW++;
    this.push((this.REG_PC_NEW >> 8) & 0xff);
    this.push(this.REG_PC_NEW & 0xff);
    this.push(status);
    this.F_INTERRUPT_NEW = 1;
    this.F_BRK_NEW = 0;

    this.REG_PC_NEW = this.load(0xfffe) | (this.load(0xffff) << 8);
    this.REG_PC_NEW--;
  },

  getStatus: function() {
    return (
      this.F_CARRY |
      (this.F_NONZERO ? 0 : 2) |
      (this.F_INTERRUPT << 2) |
      (this.F_DECIMAL << 3) |
      (this.F_BRK << 4) |
      (this.F_NOTUSED << 5) |
      (this.F_OVERFLOW << 6) |
      (this.F_SIGN << 7)
    );
  },

  setStatus: function(st) {
    this.F_CARRY = st & 1;
    this.F_NONZERO = st & 2 ? 0 : 1;
    this.F_INTERRUPT = (st >> 2) & 1;
    this.F_DECIMAL = (st >> 3) & 1;
    this.F_BRK = (st >> 4) & 1;
    this.F_NOTUSED = (st >> 5) & 1;
    this.F_OVERFLOW = (st >> 6) & 1;
    this.F_SIGN = (st >> 7) & 1;
  },
};
