import { useEffect, useMemo, useState } from 'react';
import { Archive, ArchiveRestore, PackagePlus, Pencil, Plus, Trash2, TriangleAlert } from 'lucide-react';
import { Bottle, Field, ICON_LABELS, NumberInput, PillMark, Sheet, Stepper } from '../components/ui';
import { DAY_LETTERS, DAY_NAMES, formatDate, today } from '../lib/dates';
import { activeSchedules, defaultIcon, describeSchedule, formatQty, iconOf, indexDoses, reviseSchedules, supplyOf, uid, unitLabel, type Supply } from '../lib/logic';
import { sounds } from '../lib/sounds';
import { dispatch, useStore } from '../lib/store';
import { MED_COLORS, MED_FORMS, MED_ICONS, cssColor, isCustomColor, type AppState, type FollowUp, type Med, type MedIcon, type Op, type Schedule } from '../lib/types';

type Open = { kind: 'detail'; id: string } | { kind: 'edit'; id: string | null } | { kind: 'refill'; id: string } | null;

export function supplyText(med: Med, supply: Supply): string {
  if (!supply.tracked) return 'Supply not counted';
  if (supply.level === 'out') return 'None left';
  const left = `${unitLabel(med, supply.stock)} left`;
  return supply.daysLeft != null ? `${left} · ${supply.daysLeft} ${supply.daysLeft === 1 ? 'day' : 'days'}` : left;
}

export function Cabinet(props: { addNew: boolean; onAddNewHandled: () => void }) {
  const { state } = useStore();
  const [open, setOpen] = useState<Open>(null);
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    if (props.addNew) {
      setOpen({ kind: 'edit', id: null });
      props.onAddNewHandled();
    }
  }, [props.addNew]); // eslint-disable-line react-hooks/exhaustive-deps

  const active = state.meds.filter((m) => !m.archivedAt);
  const archived = state.meds.filter((m) => m.archivedAt);
  const needRefill = active.filter((m) => supplyOf(m, state).level !== 'ok').length;
  const openMed = open && open.kind !== 'edit' ? state.meds.find((m) => m.id === open.id) : undefined;
  const editMed = open?.kind === 'edit' && open.id ? state.meds.find((m) => m.id === open.id) : undefined;

  return (
    <div className="screen">
      <header className="screen-head">
        <div>
          <h1>Medicine cabinet</h1>
          <p className="muted">
            {active.length === 0
              ? 'Nothing on the shelves yet'
              : `${active.length} ${active.length === 1 ? 'medicine' : 'medicines'}${needRefill ? ` · ${needRefill} to refill` : ''}`}
          </p>
        </div>
        <button className="btn primary" onClick={() => setOpen({ kind: 'edit', id: null })}>
          <Plus size={20} /> Add
        </button>
      </header>

      {active.length === 0 && (
        <div className="empty">
          <h3>Stock your cabinet</h3>
          <p className="muted">Add each prescription once. Rxmindly keeps count of what’s left, tells you when to refill, and fills your pill organizer.</p>
          <button className="btn primary" onClick={() => setOpen({ kind: 'edit', id: null })}>
            <Plus size={20} /> Add a medicine
          </button>
        </div>
      )}

      <div className="shelves">
        {active.map((med) => (
          <ShelfItem key={med.id} med={med} state={state} onOpen={() => setOpen({ kind: 'detail', id: med.id })} onRefill={() => setOpen({ kind: 'refill', id: med.id })} />
        ))}
      </div>

      {archived.length > 0 && (
        <section className="archived">
          <button className="btn quiet" onClick={() => setShowArchived(!showArchived)} aria-expanded={showArchived}>
            <Archive size={18} /> Put away ({archived.length})
          </button>
          {showArchived && (
            <ul className="plain-list">
              {archived.map((med) => (
                <li key={med.id}>
                  <button className="row-btn" onClick={() => setOpen({ kind: 'detail', id: med.id })}>
                    <span>
                      {med.name} <span className="muted">{med.strength}</span>
                    </span>
                    <span className="muted">since {formatDate(med.archivedAt!, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {open?.kind === 'detail' && openMed && (
        <MedDetail
          med={openMed}
          state={state}
          onClose={() => setOpen(null)}
          onEdit={() => setOpen({ kind: 'edit', id: openMed.id })}
          onRefill={() => setOpen({ kind: 'refill', id: openMed.id })}
        />
      )}
      {open?.kind === 'refill' && openMed && <RefillSheet med={openMed} state={state} onClose={() => setOpen(null)} />}
      {open?.kind === 'edit' && <MedEditor med={editMed} state={state} onClose={() => setOpen(null)} />}
    </div>
  );
}

function ShelfItem({ med, state, onOpen, onRefill }: { med: Med; state: AppState; onOpen: () => void; onRefill: () => void }) {
  const supply = supplyOf(med, state);
  return (
    <article className={`shelf-item ${supply.level}`}>
      <button className="shelf-main" onClick={onOpen} aria-label={`${med.name}: details`}>
        <Bottle color={med.color} fill={supply.fill} size={72} />
        <span className="shelf-text">
          <span className="shelf-name with-mark">
            <PillMark med={med} /> {med.name}
          </span>
          <span className="muted">{[med.strength, med.form].filter(Boolean).join(' · ')}</span>
          <span className="shelf-supply">
            {supply.level !== 'ok' && <TriangleAlert size={16} />}
            {supplyText(med, supply)}
          </span>
          <span className="muted">{describeSchedule(med)}</span>
        </span>
      </button>
      <div className="shelf-side">
        <button className={`btn small${supply.level !== 'ok' ? ' primary' : ''}`} onClick={onRefill}>
          <PackagePlus size={18} /> Refill
        </button>
        {med.refillsLeft != null && (
          <span className="shelf-refills muted">
            {med.refillsLeft === 0 ? 'No refills left' : `${med.refillsLeft} ${med.refillsLeft === 1 ? 'refill' : 'refills'} left`}
          </span>
        )}
      </div>
    </article>
  );
}

function MedDetail(props: { med: Med; state: AppState; onClose: () => void; onEdit: () => void; onRefill: () => void }) {
  const { med, state } = props;
  const supply = supplyOf(med, state);
  const refills = state.refills.filter((r) => r.medId === med.id);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const archived = med.archivedAt != null;

  const setArchived = (value: boolean) => {
    dispatch({ type: 'med.put', med: { ...med, archivedAt: value ? today() : null } });
    props.onClose();
  };

  return (
    <Sheet title={med.name} subtitle={[med.strength, med.form].filter(Boolean).join(' · ')} onClose={props.onClose}>
      <div className="detail-top">
        <Bottle color={med.color} fill={supply.fill} size={96} />
        <div>
          <p className={`detail-supply ${supply.level}`}>{supplyText(med, supply)}</p>
          {supply.runsOutOn && supply.level !== 'out' && <p className="muted">Runs out around {formatDate(supply.runsOutOn, { weekday: 'short', month: 'short', day: 'numeric' })}</p>}
          {supply.level === 'low' && <p className="tag warn"><TriangleAlert size={14} /> Time to refill</p>}
          {supply.level === 'out' && <p className="tag bad"><TriangleAlert size={14} /> Out</p>}
        </div>
      </div>

      {!archived && (
        <div className="button-row">
          <button className="btn primary" onClick={props.onRefill}>
            <PackagePlus size={20} /> Refill
          </button>
          <button className="btn" onClick={props.onEdit}>
            <Pencil size={20} /> Edit
          </button>
        </div>
      )}

      <dl className="facts">
        <div>
          <dt>When</dt>
          <dd>{describeSchedule(med)}</dd>
        </div>
        {med.instructions && (
          <div>
            <dt>Instructions</dt>
            <dd>{med.instructions}</dd>
          </div>
        )}
        {med.refillsLeft != null && (
          <div>
            <dt>Refills left</dt>
            <dd>{med.refillsLeft}</dd>
          </div>
        )}
        {med.prescriber && (
          <div>
            <dt>Prescriber</dt>
            <dd>{med.prescriber}</dd>
          </div>
        )}
        {med.pharmacy && (
          <div>
            <dt>Pharmacy</dt>
            <dd>{med.pharmacy}</dd>
          </div>
        )}
        {med.rxNumber && (
          <div>
            <dt>Rx number</dt>
            <dd>{med.rxNumber}</dd>
          </div>
        )}
      </dl>

      {refills.length > 0 && (
        <>
          <h3 className="section-title">Refill history</h3>
          <ul className="plain-list">
            {refills.slice(0, 8).map((r) => (
              <li key={r.id} className="row">
                <span>
                  {formatDate(r.date, { month: 'short', day: 'numeric', year: 'numeric' })}
                  {r.note && <span className="muted"> · {r.note}</span>}
                </span>
                <span>+{formatQty(r.qty)}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="action-list danger-zone">
        {archived ? (
          <button className="btn block" onClick={() => setArchived(false)}>
            <ArchiveRestore size={20} /> Put back in the cabinet
          </button>
        ) : (
          <button className="btn block" onClick={() => setArchived(true)}>
            <Archive size={20} /> I’ve stopped taking this
          </button>
        )}
        {!confirmDelete ? (
          <button className="btn block quiet danger" onClick={() => setConfirmDelete(true)}>
            <Trash2 size={20} /> Delete permanently
          </button>
        ) : (
          <div className="confirm">
            <p>Delete {med.name} and its whole history? This can’t be undone.</p>
            <div className="button-row">
              <button className="btn" onClick={() => setConfirmDelete(false)}>
                Keep it
              </button>
              <button
                className="btn danger-solid"
                onClick={() => {
                  dispatch({ type: 'med.delete', id: med.id });
                  props.onClose();
                }}
              >
                Delete
              </button>
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}

function RefillSheet({ med, state, onClose }: { med: Med; state: AppState; onClose: () => void }) {
  const last = state.refills.find((r) => r.medId === med.id)?.qty;
  const [qty, setQty] = useState<number | null>(last ?? 30);
  const [note, setNote] = useState('');
  const canUse = med.refillsLeft != null && med.refillsLeft > 0;
  const [useRefill, setUseRefill] = useState(canUse);
  const supply = supplyOf(med, state);
  const valid = qty != null && qty > 0;

  const save = () => {
    if (!valid) return;
    dispatch({ type: 'refill.add', refill: { id: uid(), medId: med.id, date: today(), qty, note: note.trim() }, useRefill });
    sounds.refill();
    onClose();
  };

  return (
    <Sheet
      title={`Refill ${med.name}`}
      subtitle={supply.tracked ? `${unitLabel(med, supply.stock)} in the bottle now` : undefined}
      onClose={onClose}
      footer={
        <button className="btn primary block" disabled={!valid} onClick={save}>
          Add to the bottle
        </button>
      }
    >
      <Field label="How many did you get?" hint={valid && supply.tracked ? `You’ll have ${formatQty(supply.stock + qty)} afterwards.` : undefined}>
        <NumberInput value={qty} onChange={setQty} decimal />
      </Field>
      {canUse && (
        <label className="check">
          <input type="checkbox" checked={useRefill} onChange={(e) => setUseRefill(e.target.checked)} />
          <span>
            This uses one of my {med.refillsLeft} {med.refillsLeft === 1 ? 'refill' : 'refills'}
          </span>
        </label>
      )}
      {med.refillsLeft === 0 && <p className="note warn">This prescription has no refills left — you may need a new one from your prescriber.</p>}
      <Field label="Note (optional)">
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="90-day supply, new pharmacy…" maxLength={200} />
      </Field>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------

interface Draft {
  name: string;
  strength: string;
  form: Med['form'];
  color: Med['color'];
  icon: MedIcon;
  asNeeded: boolean;
  schedules: Schedule[];
  stock: number | null;
  lowDays: number | null;
  refillsLeft: number | null;
  instructions: string;
  prescriber: string;
  pharmacy: string;
  rxNumber: string;
}

const newSchedule = (existing: Schedule[]): Schedule => {
  const used = new Set(existing.map((s) => s.time));
  const time = ['08:00', '20:00', '12:00', '16:00'].find((t) => !used.has(t)) ?? '09:00';
  return { id: uid(), time, qty: 1, days: '0123456', startDate: today(), endDate: null };
};

function MedEditor({ med, state, onClose }: { med: Med | undefined; state: AppState; onClose: () => void }) {
  const doses = useMemo(() => indexDoses(state), [state]);
  const [draft, setDraft] = useState<Draft>(() =>
    med
      ? { ...med, icon: iconOf(med), schedules: activeSchedules(med), lowDays: med.lowDays }
      : {
          name: '',
          strength: '',
          form: 'tablet',
          icon: 'round',
          // Start each new bottle on a color not already on the shelf, when there is one.
          color: MED_COLORS.find((c) => !state.meds.some((m) => m.color === c && !m.archivedAt)) ?? 'blue',
          asNeeded: false,
          schedules: [newSchedule([])],
          stock: null,
          lowDays: 7,
          refillsLeft: null,
          instructions: '',
          prescriber: '',
          pharmacy: '',
          rxNumber: '',
        },
  );
  const [tried, setTried] = useState(false);
  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));
  const patchSchedule = (id: string, p: Partial<Schedule>) => patch({ schedules: draft.schedules.map((s) => (s.id === id ? { ...s, ...p } : s)) });

  const nameMissing = !draft.name.trim();
  const scheduleMissing = !draft.asNeeded && draft.schedules.length === 0;
  const duplicateTime = !draft.asNeeded && new Set(draft.schedules.map((s) => s.time)).size !== draft.schedules.length;
  const badWait = !draft.asNeeded && draft.schedules.some((s) => (s.followUps ?? []).some((f) => f.afterMinutes < 1 || f.afterMinutes > 2880));
  const patchFollowUps = (s: Schedule, change: (list: FollowUp[]) => FollowUp[]) => patchSchedule(s.id, { followUps: change(s.followUps ?? []) });

  const save = () => {
    setTried(true);
    if (nameMissing || scheduleMissing || duplicateTime || badWait) return;
    const edited = draft.asNeeded ? [] : draft.schedules;
    const next: Med = {
      id: med?.id ?? uid(),
      name: draft.name.trim(),
      strength: draft.strength.trim(),
      form: draft.form,
      color: draft.color,
      icon: draft.icon,
      asNeeded: draft.asNeeded,
      schedules: med ? reviseSchedules(med.schedules, edited, doses) : edited,
      stock: draft.stock,
      lowDays: draft.lowDays ?? 7,
      refillsLeft: draft.refillsLeft == null ? null : Math.round(draft.refillsLeft),
      instructions: draft.instructions.trim(),
      prescriber: draft.prescriber.trim(),
      pharmacy: draft.pharmacy.trim(),
      rxNumber: draft.rxNumber.trim(),
      archivedAt: med?.archivedAt ?? null,
    };
    const ops: Op[] = [{ type: 'med.put', med: next }];
    if (med && med.stock !== draft.stock) ops.push({ type: 'stock.set', medId: med.id, stock: draft.stock });
    dispatch(...ops);
    onClose();
  };

  return (
    <Sheet
      title={med ? `Edit ${med.name}` : 'Add a medicine'}
      onClose={onClose}
      footer={
        <button className="btn primary block" onClick={save}>
          {med ? 'Save changes' : 'Put it in the cabinet'}
        </button>
      }
    >
      <Field label="Name">
        <input className="input" value={draft.name} onChange={(e) => patch({ name: e.target.value })} placeholder="Lisinopril" maxLength={120} autoFocus={!med} />
        {tried && nameMissing && <span className="field-error">Give the medicine a name.</span>}
      </Field>
      <div className="field-pair">
        <Field label="Strength">
          <input className="input" value={draft.strength} onChange={(e) => patch({ strength: e.target.value })} placeholder="10 mg" maxLength={60} />
        </Field>
        <Field label="Form">
          <select className="input" value={draft.form} onChange={(e) => {
              const form = e.target.value as Med['form'];
              // The picture follows the form until you pick a different one yourself.
              patch(draft.icon === defaultIcon(draft.form) ? { form, icon: defaultIcon(form) } : { form });
            }}
          >
            {MED_FORMS.map((f) => (
              <option key={f} value={f}>
                {f[0].toUpperCase() + f.slice(1)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="field">
        <span className="field-label">Bottle color</span>
        <div className="swatches" role="radiogroup" aria-label="Bottle color">
          {MED_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={draft.color === c}
              aria-label={c}
              className={`swatch${draft.color === c ? ' selected' : ''}`}
              style={{ background: cssColor(c) }}
              onClick={() => patch({ color: c })}
            />
          ))}
          {/* Any color you like: opens the phone's or browser's color picker. */}
          <label className={`swatch custom${isCustomColor(draft.color) ? ' selected' : ''}`} style={isCustomColor(draft.color) ? { background: draft.color } : undefined} title="Pick your own color">
            <input type="color" value={isCustomColor(draft.color) ? draft.color : '#888888'} onChange={(e) => patch({ color: e.target.value as Med['color'] })} aria-label="Pick your own color" />
            {!isCustomColor(draft.color) && <Plus size={18} />}
          </label>
        </div>
      </div>

      <div className="field">
        <span className="field-label">What it looks like</span>
        <div className="icon-choices" role="radiogroup" aria-label="What it looks like">
          {MED_ICONS.map((icon) => (
            <button key={icon} type="button" role="radio" aria-checked={draft.icon === icon} className={`icon-choice${draft.icon === icon ? ' selected' : ''}`} onClick={() => patch({ icon })}>
              <PillMark med={{ color: draft.color, form: draft.form, icon }} />
              {ICON_LABELS[icon]}
            </button>
          ))}
        </div>
      </div>

      <h3 className="section-title">When do you take it?</h3>
      <div className="segmented" role="radiogroup" aria-label="How it is taken">
        <button type="button" role="radio" aria-checked={!draft.asNeeded} className={!draft.asNeeded ? 'on' : ''} onClick={() => patch({ asNeeded: false, schedules: draft.schedules.length ? draft.schedules : [newSchedule([])] })}>
          On a schedule
        </button>
        <button type="button" role="radio" aria-checked={draft.asNeeded} className={draft.asNeeded ? 'on' : ''} onClick={() => patch({ asNeeded: true })}>
          Only as needed
        </button>
      </div>

      {!draft.asNeeded && (
        <>
          {draft.schedules.map((s) => (
            <div className="schedule-row" key={s.id}>
              <div className="schedule-top">
                <input className="input time" type="time" value={s.time} onChange={(e) => e.target.value && patchSchedule(s.id, { time: e.target.value })} aria-label="Time" />
                <Stepper value={s.qty} step={0.5} min={0.5} onChange={(qty) => patchSchedule(s.id, { qty })} label="How many" />
                <button type="button" className="icon-btn" onClick={() => patch({ schedules: draft.schedules.filter((x) => x.id !== s.id) })} aria-label="Remove this time">
                  <Trash2 size={20} />
                </button>
              </div>
              <div className="day-toggles" role="group" aria-label="Days of the week">
                {DAY_LETTERS.map((letter, i) => {
                  const on = s.days.includes(String(i));
                  return (
                    <button
                      key={i}
                      type="button"
                      aria-pressed={on}
                      aria-label={DAY_NAMES[i]}
                      className={on ? 'on' : ''}
                      onClick={() => {
                        const days = on ? s.days.replace(String(i), '') : [...s.days, String(i)].sort().join('');
                        if (days) patchSchedule(s.id, { days });
                      }}
                    >
                      {letter}
                    </button>
                  );
                })}
              </div>
              {(s.followUps ?? []).map((f, i) => (
                <div className="follow-up" key={i}>
                  <div className="follow-up-top">
                    <strong>Next dose</strong>
                    <Stepper value={f.qty} step={0.5} min={0.5} onChange={(qty) => patchFollowUps(s, (list) => list.map((x, j) => (j === i ? { ...x, qty } : x)))} label="How many" />
                    <button type="button" className="icon-btn" onClick={() => patchFollowUps(s, (list) => list.filter((_, j) => j !== i))} aria-label="Remove this follow-up dose">
                      <Trash2 size={20} />
                    </button>
                  </div>
                  <div className="follow-up-wait">
                    <NumberInput
                      value={Math.floor(f.afterMinutes / 60) || null}
                      placeholder="0"
                      onChange={(h) => patchFollowUps(s, (list) => list.map((x, j) => (j === i ? { ...x, afterMinutes: Math.round(h ?? 0) * 60 + (x.afterMinutes % 60) } : x)))}
                      ariaLabel="Hours to wait"
                    />
                    hr
                    <NumberInput
                      value={f.afterMinutes % 60 || null}
                      placeholder="0"
                      onChange={(m) => patchFollowUps(s, (list) => list.map((x, j) => (j === i ? { ...x, afterMinutes: Math.floor(x.afterMinutes / 60) * 60 + Math.min(59, Math.round(m ?? 0)) } : x)))}
                      ariaLabel="Minutes to wait"
                    />
                    min
                    <span className="follow-up-note">after the {i === 0 ? 'first dose' : 'dose before'} is marked taken</span>
                  </div>
                </div>
              ))}
              <button
                type="button"
                className="btn small quiet"
                onClick={() => patchFollowUps(s, (list) => [...list, { afterMinutes: list[list.length - 1]?.afterMinutes ?? 240, qty: list[list.length - 1]?.qty ?? s.qty }])}
              >
                <Plus size={18} /> Add a follow-up dose
              </button>
            </div>
          ))}
          <button type="button" className="btn small" onClick={() => patch({ schedules: [...draft.schedules, newSchedule(draft.schedules)] })}>
            <Plus size={18} /> Add another time
          </button>
          {tried && scheduleMissing && <p className="field-error">Add at least one time, or choose “Only as needed”.</p>}
          {tried && badWait && <p className="field-error">Give each follow-up dose a wait between 1 minute and 48 hours.</p>}
          {tried && duplicateTime && <p className="field-error">Two of these times are the same. Change one, or raise the amount instead.</p>}
        </>
      )}

      <h3 className="section-title">Supply</h3>
      <div className="field-pair">
        <Field label="How many you have" hint="Leave empty to not keep count.">
          <NumberInput value={draft.stock} onChange={(stock) => patch({ stock })} decimal placeholder="30" />
        </Field>
        <Field label="Refills left" hint="On the prescription label.">
          <NumberInput value={draft.refillsLeft} onChange={(refillsLeft) => patch({ refillsLeft })} placeholder="—" />
        </Field>
      </div>
      {!draft.asNeeded && (
        <Field label="Warn me when this many days are left">
          <NumberInput value={draft.lowDays} onChange={(lowDays) => patch({ lowDays })} placeholder="7" />
        </Field>
      )}

      <h3 className="section-title">Label details (optional)</h3>
      <Field label="Instructions">
        <input className="input" value={draft.instructions} onChange={(e) => patch({ instructions: e.target.value })} placeholder="With food" maxLength={200} />
      </Field>
      <div className="field-pair">
        <Field label="Prescriber">
          <input className="input" value={draft.prescriber} onChange={(e) => patch({ prescriber: e.target.value })} maxLength={120} />
        </Field>
        <Field label="Pharmacy">
          <input className="input" value={draft.pharmacy} onChange={(e) => patch({ pharmacy: e.target.value })} maxLength={120} />
        </Field>
      </div>
      <Field label="Rx number">
        <input className="input" value={draft.rxNumber} onChange={(e) => patch({ rxNumber: e.target.value })} maxLength={60} />
      </Field>
    </Sheet>
  );
}
