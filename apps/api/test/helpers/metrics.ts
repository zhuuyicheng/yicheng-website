import type { Counter } from 'prom-client';

/** Current value of a counter, summed over every label set that matches `labels`. */
export async function counterValue<Label extends string>(
  counter: Counter<Label>,
  labels: Partial<Record<Label, string>> = {},
): Promise<number> {
  const { values } = await counter.get();
  return values
    .filter((sample) => {
      const sampleLabels: Record<string, unknown> = sample.labels;
      return Object.entries(labels).every(([name, value]) => sampleLabels[name] === value);
    })
    .reduce((sum, sample) => sum + sample.value, 0);
}
