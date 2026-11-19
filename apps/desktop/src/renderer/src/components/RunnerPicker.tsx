import type { RunnerId, RunnerStatus } from "@amc/contracts";
import { RUNNER_LABEL } from "../review/review-model";
import { SourceMark } from "./SourceMark";

/**
 * Which of the tools that are switched on does the work: a segment each, under its own mark.
 * `name` groups the radios, so two pickers on screen at once do not answer for each other.
 */
export function RunnerPicker({ runners, chosen, onChoose, name }: { runners: RunnerStatus[]; chosen: RunnerId; onChoose: (runner: RunnerId) => void; name: string }) {
  return (
    <div className="seg runner-picker" role="radiogroup" aria-label="Ask">
      {runners.map(({ runner }) => (
        <label key={runner} className="seg-opt" data-selected={runner === chosen || undefined}>
          <input type="radio" name={name} checked={runner === chosen} onChange={() => onChoose(runner)} />
          <SourceMark of={runner} size={14} />
          {RUNNER_LABEL[runner]}
        </label>
      ))}
    </div>
  );
}
