const { fields } = foundry.data;

export const DAMAGE = {
  REGULAR: 0,
  BLUNT: 1,
  LETHAL: 2,
  CRITICAL: 3
};

function getInitialHpDimensions(model) {
  const rows = Math.max(1, Number(model?.rows) || 5);
  const cols = Math.max(1, Number(model?.cols) || 7);
  return { rows, cols };
}

export class HPGridModel extends foundry.abstract.DataModel {
  static defineSchema() {
    return {
      rows: new fields.NumberField({
        integer: true,
        initial: 5,
        min: 1
      }),
      cols: new fields.NumberField({
        integer: true,
        initial: 7,
        min: 1
      }),
      grid: new fields.ArrayField(
        new fields.ArrayField(
          new fields.NumberField({
            integer: true,
            min: 0,
            max: 3,
            initial: DAMAGE.REGULAR
          })
        ),
        {
          initial: model => {
            const { rows, cols } = getInitialHpDimensions(model);
            return Array.from({ length: rows }, () =>
              Array(cols).fill(DAMAGE.REGULAR)
            );
          }
        }
      )
    };
  }

  canOverwrite(existing, incoming) {
    return incoming > existing;
  }

  applyBlunt(amount) {
    let remaining = amount;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (!remaining) return remaining;
        if (this.canOverwrite(this.grid[r][c], DAMAGE.BLUNT)) {
          this.grid[r][c] = DAMAGE.BLUNT;
          remaining--;
        }
      }
    }
    return remaining;
  }

  applyLethal(amount) {
    let remaining = amount;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (!remaining) return remaining;
        if (this.canOverwrite(this.grid[r][c], DAMAGE.LETHAL)) {
          this.grid[r][c] = DAMAGE.LETHAL;
          remaining--;
        }
      }
    }
    return remaining;
  }

  applyCritical(amount) {
    let remaining = amount;
    for (let c = this.cols - 1; c >= 0; c--) {
      for (let r = this.rows - 1; r >= 0; r--) {
        if (!remaining) return remaining;
        if (this.canOverwrite(this.grid[r][c], DAMAGE.CRITICAL)) {
          this.grid[r][c] = DAMAGE.CRITICAL;
          remaining--;
        }
      }
    }
    return remaining;
  }

  applyDamage(type, amount, hardLocation = false) {
    if (type === "lethal" && hardLocation) {
      const lethal = Math.ceil(amount / 2);
      const blunt = Math.floor(amount / 2);

      let rem = this.applyLethal(lethal);
      if (rem) this.applyCritical(rem);

      rem = this.applyBlunt(blunt);
      if (rem) this.applyLethal(rem);
      return;
    }

    if (type === "blunt") {
      let rem = this.applyBlunt(amount);
      if (rem) this.applyLethal(rem);
    }

    if (type === "lethal") {
      let rem = this.applyLethal(amount);
      if (rem) this.applyCritical(rem);
    }

    if (type === "critical") {
      this.applyCritical(amount);
    }
  }

  get worstRow() {
    for (let r = this.rows - 1; r >= 0; r--) {
      if (this.grid[r].some(v => v > DAMAGE.REGULAR)) return r + 1;
    }
    return 0;
  }

  get healthState() {
    return ["Perfect", "Good", "Wounded", "Poor", "Terrible", "Critical"][this.worstRow];
  }

  applyHealing(amount, canHealCritical = false) {
    let remaining = amount;
    
    // Heal right-to-left, bottom-to-top (complete each column from bottom to top before moving left)
    for (let r = this.rows - 1; r >= 0; r--) {
      for (let c = this.cols - 1; c >= 0; c--) {
        if (!remaining) return;
        
        const current = this.grid[r][c];
        
        // Skip critical damage if we can't heal it
        if (current === DAMAGE.CRITICAL && !canHealCritical) {
          continue;
        }
        
        // Heal any damage that isn't REGULAR
        if (current > DAMAGE.REGULAR) {
          this.grid[r][c] = DAMAGE.REGULAR;
          remaining--;
        }
      }
    }
  }
}
