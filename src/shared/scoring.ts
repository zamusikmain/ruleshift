export class Scoring {
  bonus = 0;
  perfects = 0;
  nearMisses = 0;
  private boostedTime = 0;
  multiplier = 1;
  tick(dt: number, boosted: boolean): void {
    this.multiplier = boosted ? 2 : 1;
    if (boosted) this.boostedTime += dt;
  }
  nearMiss(): number {
    this.nearMisses++;
    const reward = 20 * this.multiplier;
    this.bonus += reward;
    return reward;
  }
  streak = 0;
  bestStreak = 0;
  rules = 0;
  chaos = 0;
  complete(count = 1): number {
    this.perfects++;
    this.streak++;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    this.rules += count;
    if (count > 1) this.chaos++;
    const reward = 100 * Math.min(5, this.streak) * count * this.multiplier;
    this.bonus += reward;
    return reward;
  }
  fail(): void {
    this.streak = 0;
  }
  score(time: number): number {
    return Math.floor((time + this.boostedTime) * 10) + this.bonus;
  }
}
