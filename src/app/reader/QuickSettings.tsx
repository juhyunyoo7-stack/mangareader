import type { PrefScope } from '../../core/prefs.ts';
import type {
  FilterPreset,
  FitMode,
  GlobalPrefs,
  LayoutMode,
  PageOverride,
  ReaderPrefs,
  Direction,
} from '../../core/types.ts';
import { Sheet } from '../components/Sheet.tsx';
import { S } from '../../strings.ts';

function Seg<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  const id = `lbl-${label.replace(/[^\p{L}\p{N}]+/gu, '-')}`;
  return (
    <div class="setting">
      <span class="label" id={id}>
        {label}
      </span>
      <div class="seg" role="group" aria-labelledby={id}>
        {options.map(([v, text]) => (
          <button key={v} aria-pressed={value === v} onClick={() => onChange(v)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

export function QuickSettings({
  prefs,
  scope,
  overrides,
  hasSeries,
  onScope,
  onChange,
  onClearOverrides,
  onClose,
}: {
  prefs: GlobalPrefs;
  scope: PrefScope;
  overrides: PageOverride[];
  hasSeries: boolean;
  onScope: (s: PrefScope) => void;
  onChange: (p: ReaderPrefs) => void;
  onClearOverrides: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet title={S.readerSettings} onClose={onClose}>
      <Seg
        label={S.applyChangesTo}
        value={scope}
        options={
          hasSeries
            ? [
                ['book', S.thisBook],
                ['series', S.wholeSeries],
              ]
            : [['book', S.thisBook]]
        }
        onChange={onScope}
      />
      <Seg<LayoutMode>
        label={S.layoutLabel}
        value={prefs.layout}
        options={[
          ['single', S.layoutSingle],
          ['double', S.layoutDouble],
          ['auto', S.layoutAuto],
          ['webtoon', S.layoutWebtoon],
        ]}
        onChange={(layout) => onChange({ layout })}
      />
      <Seg<Direction>
        label={S.directionLabel}
        value={prefs.direction}
        options={[
          ['ltr', S.dirLtr],
          ['rtl', S.dirRtl],
          ['vertical', S.dirVertical],
        ]}
        onChange={(direction) => onChange({ direction })}
      />
      <Seg<FitMode>
        label={S.fit}
        value={prefs.fit}
        options={[
          ['screen', S.fitScreen],
          ['width', S.fitWidth],
          ['height', S.fitHeight],
          ['original', S.fitOriginal],
        ]}
        onChange={(fit) => onChange({ fit })}
      />
      <div class="setting">
        <label class="label" for="cover-offset">
          {S.coverOwnPage}
          <span class="hint">{S.coverOwnPageHint}</span>
        </label>
        <input
          id="cover-offset"
          type="checkbox"
          checked={prefs.coverOffset}
          onChange={(e) => onChange({ coverOffset: e.currentTarget.checked })}
        />
      </div>
      <Seg<'0' | '1'>
        label={S.pairingShift}
        value={String(prefs.pairShift) as '0' | '1'}
        options={[
          ['0', S.pairNormal],
          ['1', S.pairShifted],
        ]}
        onChange={(v) => onChange({ pairShift: Number(v) as 0 | 1 })}
      />
      <Seg<FilterPreset>
        label={S.imageFilter}
        value={prefs.filters.preset}
        options={[
          ['none', S.filterOff],
          ['dim', S.filterDim],
          ['invert-soft', S.filterInvertSoft],
          ['sepia', S.filterSepia],
          ['eink', S.filterEink],
        ]}
        onChange={(preset) => onChange({ filters: { ...prefs.filters, preset } })}
      />
      <div class="setting">
        <label class="label" for="flt-brightness">
          {S.brightness}
        </label>
        <input
          id="flt-brightness"
          type="range"
          min="0.5"
          max="1.5"
          step="0.05"
          value={prefs.filters.brightness}
          onInput={(e) =>
            onChange({ filters: { ...prefs.filters, brightness: Number(e.currentTarget.value) } })
          }
        />
      </div>
      <div class="setting">
        <label class="label" for="flt-contrast">
          {S.contrast}
        </label>
        <input
          id="flt-contrast"
          type="range"
          min="0.5"
          max="1.5"
          step="0.05"
          value={prefs.filters.contrast}
          onInput={(e) =>
            onChange({ filters: { ...prefs.filters, contrast: Number(e.currentTarget.value) } })
          }
        />
      </div>
      <div class="setting">
        <label class="label" for="auto-trim">
          {S.trimMargins}
          <span class="hint">{S.trimMarginsHint}</span>
        </label>
        <input
          id="auto-trim"
          type="checkbox"
          checked={prefs.autoTrim}
          onChange={(e) => onChange({ autoTrim: e.currentTarget.checked })}
        />
      </div>
      <div class="setting">
        <label class="label" for="guided-view">
          {S.guidedView}{' '}
          <span class="badge badge-warn badge-inline" data-testid="guided-experimental">
            {S.experimental}
          </span>
          <span class="hint">{S.guidedViewHint}</span>
        </label>
        <input
          id="guided-view"
          type="checkbox"
          checked={prefs.guided}
          onChange={(e) => onChange({ guided: e.currentTarget.checked })}
        />
      </div>
      <div class="setting">
        <span class="label">
          {S.pageOverrides}
          <span class="hint">{S.pageOverridesHint}</span>
        </span>
        <button class="btn small" disabled={overrides.length === 0} onClick={onClearOverrides}>
          {S.clear} {overrides.length || ''}
        </button>
      </div>
    </Sheet>
  );
}
