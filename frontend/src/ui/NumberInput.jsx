// A number field that commits when the player finishes editing (the browser's change event, not every keystroke), and goes
// back to the last good value if what they typed is not a valid number.

import { useEffect, useRef } from 'react';

export function NumberInput({ value, min = 0, max = Infinity, clampMax = true, step, onCommit, ...rest }) {
  const ref = useRef(null);
  const good = useRef(value); // the figures it edits live outside React, so a commit may not change the value prop
  const latest = useRef({ min, max, clampMax, onCommit });
  latest.current = { min, max, clampMax, onCommit };
  useEffect(() => {
    good.current = value;
    if (document.activeElement !== ref.current) ref.current.value = value;
  }, [value]);
  useEffect(() => {
    const el = ref.current;
    const onChange = () => {
      const v = Number(el.value);
      if (el.value !== '' && Number.isFinite(v) && v >= latest.current.min && (latest.current.clampMax || v <= latest.current.max)) {
        const bounded = Math.min(v, latest.current.max);
        good.current = bounded;
        el.value = bounded;
        latest.current.onCommit(bounded);
      } else el.value = good.current;
    };
    el.addEventListener('change', onChange);
    return () => el.removeEventListener('change', onChange);
  }, []);
  return <input ref={ref} type="number" defaultValue={value} step={step} min={min} max={Number.isFinite(max) ? max : undefined} {...rest} />;
}
