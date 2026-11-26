import { describe, expect, it } from 'vitest';
import { RUN } from '../config';
import { Run } from './run';

function started(at = 0): Run {
  const run = new Run();
  run.start(at);
  return run;
}

describe('free-play run', () => {
  it('starts with the full stock; each shot spends one ball and each front-edge ball returns one, up to the cap', () => {
    const run = new Run();
    expect(run.fire()).toBe(false); // not started
    expect(run.canStart).toBe(true);
    run.start(0);
    expect(run.stock).toBe(RUN.startStock);
    expect(run.fire()).toBe(true);
    expect(run.stock).toBe(RUN.startStock - 1);
    run.ballOut();
    expect(run.stock).toBe(RUN.startStock);
    run.stock = RUN.stockCap;
    run.ballOut();
    expect(run.stock).toBe(RUN.stockCap);
  });

  it('warns once when the stock falls to the low mark', () => {
    const run = started();
    run.stock = RUN.lowStock + 1;
    run.fire();
    run.fire();
    expect(run.drainEvents()).toEqual(['lowStock']);
  });

  it('going broke opens sudden death; a ball off the front revives the run', () => {
    const run = started();
    run.stock = 0;
    run.tick(10, 1, true, 0);
    expect(run.phase).toBe('playing'); // a shot is still falling
    run.tick(11, 0, true, 0);
    expect(run.phase).toBe('suddenDeath');
    expect(run.graceLeft).toBe(RUN.suddenDeathSeconds);
    run.tick(13, 0, true, 0);
    expect(run.fire()).toBe(false);
    run.ballOut();
    expect({ phase: run.phase, stock: run.stock }).toEqual({ phase: 'playing', stock: 1 });
    expect(run.drainEvents()).toEqual(['suddenDeath', 'revive']);
  });

  it('when sudden death runs out the tray is swept, and the run ends once the disk has settled', () => {
    const run = started();
    run.stock = 0;
    run.tick(5, 0, true, 0);
    run.tick(5 + RUN.suddenDeathSeconds, 0, true, 0);
    expect(run.phase).toBe('sweep');
    run.ballOut(); // no refills during the sweep
    expect(run.stock).toBe(0);
    run.tick(5 + RUN.suddenDeathSeconds + RUN.sweepSeconds, 0, false, 300);
    expect(run.phase).toBe('sweep'); // a pearl is still rolling: it pays first
    run.tick(5 + RUN.suddenDeathSeconds + RUN.sweepSeconds + 1, 0, true, 420);
    expect({ phase: run.phase, finalScore: run.finalScore, active: run.active }).toEqual({ phase: 'over', finalScore: 420, active: false });
    expect(run.drainEvents()).toEqual(['suddenDeath', 'sweep', 'over']);
  });

  it('a sweep that never settles still ends at the cap', () => {
    const run = started();
    run.stock = 0;
    run.tick(1, 0, true, 0);
    run.tick(1 + RUN.suddenDeathSeconds, 0, true, 0);
    run.tick(1 + RUN.suddenDeathSeconds + RUN.sweepMaxSeconds, 0, false, 5);
    expect(run.phase).toBe('over');
  });

  it('Last Call stops refills; the run is swept once the last ball has fallen', () => {
    const run = started(100);
    run.tick(100 + RUN.lastCallSeconds / 2, 0, true, 0);
    expect(run.clock).toBe(RUN.lastCallSeconds / 2);
    run.tick(100 + RUN.lastCallSeconds, 0, true, 0);
    expect({ phase: run.phase, clock: run.clock }).toEqual({ phase: 'lastCall', clock: 0 });
    const stock = run.stock;
    run.ballOut();
    expect(run.stock).toBe(stock);
    expect(run.fire()).toBe(true);
    run.stock = 0;
    run.tick(100 + RUN.lastCallSeconds + 30, 1, true, 0);
    expect(run.phase).toBe('lastCall');
    run.tick(100 + RUN.lastCallSeconds + 31, 0, true, 0);
    expect(run.phase).toBe('sweep');
    expect(run.drainEvents()).toEqual(['lastCall', 'sweep']);
  });

  it('Last Call during sudden death cancels the revive window', () => {
    const run = started();
    run.stock = 0;
    run.tick(RUN.lastCallSeconds - 1, 0, true, 0);
    expect(run.phase).toBe('suddenDeath');
    run.tick(RUN.lastCallSeconds, 0, true, 0);
    expect(run.phase).toBe('sweep');
  });

  it('deadlines apply before the step’s refills: no refill after Last Call, no revive after sudden death expires', () => {
    const run = started();
    run.deadlines(RUN.lastCallSeconds);
    const stock = run.stock;
    run.ballOut();
    expect({ phase: run.phase, stock: run.stock }).toEqual({ phase: 'lastCall', stock });

    const broke = started(0);
    broke.stock = 0;
    broke.tick(10, 0, true, 0);
    broke.deadlines(10 + RUN.suddenDeathSeconds);
    broke.ballOut();
    expect({ phase: broke.phase, stock: broke.stock }).toEqual({ phase: 'sweep', stock: 0 });
  });

  it('callLast forces Last Call only while playing', () => {
    const run = new Run();
    run.callLast();
    expect(run.phase).toBe('ready');
    run.start(0);
    run.callLast();
    expect(run.phase).toBe('lastCall');
    expect(run.clock).toBe(0);
  });

  it('ignores a start press for a moment after the run ends', () => {
    const run = started();
    run.stock = 0;
    run.tick(1, 0, true, 0);
    run.tick(1 + RUN.suddenDeathSeconds, 0, true, 0);
    const end = 1 + RUN.suddenDeathSeconds + RUN.sweepSeconds;
    run.tick(end, 0, true, 9);
    expect(run.canStart).toBe(false);
    run.now = end + RUN.overLockSeconds;
    expect(run.canStart).toBe(true);
    run.start(run.now);
    expect({ phase: run.phase, stock: run.stock, finalScore: run.finalScore }).toEqual({ phase: 'playing', stock: RUN.startStock, finalScore: 0 });
  });
});
