import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Crowding } from './crowding';

describe('Crowding', () => {
  let fixture: ComponentFixture<Crowding>;
  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const render = async (forecast: string): Promise<void> => {
    fixture.componentRef.setInput('forecast', forecast);
    await fixture.whenStable();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Crowding] }).compileComponents();
    fixture = TestBed.createComponent(Crowding);
  });

  it.each([
    ['LOW', 1, 'Crowding: quiet'],
    ['MEDIUM', 2, 'Crowding: busy'],
    ['HIGH', 3, 'Crowding: very busy'],
  ])('maps %s to %i filled pips', async (forecast, filled, label) => {
    await render(forecast);
    expect(element().querySelectorAll('.pip')).toHaveLength(3);
    expect(element().querySelectorAll('.pip.filled')).toHaveLength(filled);
    expect(element().querySelector('[role="img"]')?.getAttribute('aria-label')).toBe(label);
  });

  it('shows nothing for an unknown forecast', async () => {
    await render('UNKNOWN');
    expect(element().querySelector('.pip')).toBeNull();
  });
});
