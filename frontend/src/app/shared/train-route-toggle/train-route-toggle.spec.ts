import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TrainRouteSetting } from '../train-route-setting';
import { TrainRouteToggle } from './train-route-toggle';

describe('TrainRouteToggle', () => {
  let fixture: ComponentFixture<TrainRouteToggle>;
  const button = (): HTMLButtonElement =>
    (fixture.nativeElement as HTMLElement).querySelector('button[role="switch"]')!;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({ imports: [TrainRouteToggle] }).compileComponents();
    fixture = TestBed.createComponent(TrainRouteToggle);
    await fixture.whenStable();
  });
  afterEach(() => localStorage.clear());

  it('is off by default, with a label', () => {
    expect(button().getAttribute('aria-checked')).toBe('false');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Show train route');
  });

  it('turns the shared setting on and persists it', async () => {
    button().click();
    await fixture.whenStable();
    expect(TestBed.inject(TrainRouteSetting).show()).toBe(true);
    expect(button().getAttribute('aria-checked')).toBe('true');
    expect(localStorage.getItem('spitsrit.showTrainRoute')).toBe('1');
  });
});
