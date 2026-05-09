const { fields } = foundry.data;

export class StressModel extends foundry.abstract.DataModel {
  static defineSchema() {
    return {
      physical0: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      physical1: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      physical2: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      physical3: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      mental0: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      mental1: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      mental2: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      mental3: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      general0: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      general1: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      general2: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      general3: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      general4: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      general5: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      general6: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 }),
      general7: new fields.NumberField({ integer: true, min: 0, max: 3, initial: 0 })
    };
  }
  
  // Helper to get stress values as arrays for template
  get physical() {
    return [this.physical0, this.physical1, this.physical2, this.physical3];
  }
  
  get mental() {
    return [this.mental0, this.mental1, this.mental2, this.mental3];
  }
  
  get general() {
    return [this.general0, this.general1, this.general2, this.general3, this.general4, this.general5, this.general6, this.general7];
  }
}
