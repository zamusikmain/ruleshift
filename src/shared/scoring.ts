export class Scoring {
  bonus = 0;
  streak = 0;
  bestStreak = 0;
  rules = 0;
  chaos = 0;
  complete(count = 1): number {
    this.streak++;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    this.rules += count;
    if (count > 1) this.chaos++;
    const reward = 100 * Math.min(5, this.streak) * count;
    this.bonus += reward;
    return reward;
  }
  fail(): void {
    this.streak = 0;
  }
  score(time: number): number {
    return Math.floor(time * 10) + this.bonus;
  }
}
