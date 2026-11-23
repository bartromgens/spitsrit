import { Commute } from '../api/models';
import { sortCommutes } from './commutes';

const base: Commute = {
  id: 1,
  name: 'To work',
  origin_code: 'UT',
  origin_name: 'Utrecht Centraal',
  destination_code: 'ASD',
  destination_name: 'Amsterdam Centraal',
  created_at: '2026-11-20T07:00:00Z',
};

describe('sortCommutes', () => {
  const at = (time: string): Commute => ({ ...base, name: time, usual_departure_time: time });
  const names = (list: Commute[], hour: number, minute: number): string[] =>
    sortCommutes(list, new Date(2026, 10, 23, hour, minute)).map((c) => c.name);
  const both = [at('17:30:00'), at('08:05:00')];

  it('puts the morning commute first before it departs', () => {
    expect(names(both, 7, 30)).toEqual(['08:05:00', '17:30:00']);
  });

  it('keeps a commute on top within the 30 minute grace period', () => {
    expect(names(both, 8, 20)).toEqual(['08:05:00', '17:30:00']);
    expect(names(both, 8, 35)).toEqual(['08:05:00', '17:30:00']);
  });

  it('moves a commute to tomorrow after the grace period', () => {
    expect(names(both, 8, 36)).toEqual(['17:30:00', '08:05:00']);
    expect(names(both, 9, 0)).toEqual(['17:30:00', '08:05:00']);
  });

  it('puts the next morning commute first in the evening', () => {
    expect(names(both, 18, 10)).toEqual(['08:05:00', '17:30:00']);
  });

  it('counts a 23:50 commute at 00:10 as within the grace period', () => {
    expect(names([at('08:00:00'), at('23:50:00')], 0, 10)).toEqual(['23:50:00', '08:00:00']);
  });

  it('counts a 00:10 commute at 23:50 as coming up', () => {
    expect(names([at('08:00:00'), at('00:10:00')], 23, 50)).toEqual(['00:10:00', '08:00:00']);
  });

  it('puts commutes without a usual time last, by name', () => {
    const none = (name: string): Commute => ({ ...base, name, usual_departure_time: null });
    expect(names([none('b'), at('17:30:00'), none('a')], 9, 0)).toEqual(['17:30:00', 'a', 'b']);
  });

  it('does not change the input', () => {
    const input = [...both];
    sortCommutes(input, new Date(2026, 10, 23, 9, 0));
    expect(input).toEqual(both);
  });
});
