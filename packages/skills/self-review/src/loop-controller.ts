import { REVIEW_SCORE_THRESHOLD, MAX_SELF_REVIEW_ITERATIONS } from "@moltclip/shared";

export interface LoopState {
  iteration: number;
  maxIterations: number;
  scoreHistory: number[];
  improvements: string[];
}

export function createLoopState(maxIterations?: number): LoopState {
  return {
    iteration: 0,
    maxIterations: maxIterations ?? MAX_SELF_REVIEW_ITERATIONS,
    scoreHistory: [],
    improvements: [],
  };
}

export function shouldContinue(state: LoopState, currentScore: number): boolean {
  state.scoreHistory.push(currentScore);
  state.iteration++;

  // Score meets threshold
  if (currentScore >= REVIEW_SCORE_THRESHOLD) {
    return false;
  }

  // Max iterations reached
  if (state.iteration >= state.maxIterations) {
    return false;
  }

  // Score is not improving (last 2 iterations same or declining)
  if (state.scoreHistory.length >= 2) {
    const prev = state.scoreHistory[state.scoreHistory.length - 2];
    if (currentScore <= prev) {
      return false;
    }
  }

  return true;
}

export function recordImprovement(state: LoopState, description: string): void {
  state.improvements.push(description);
}
