import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Carriages } from './carriages';

describe('Carriages', () => {
  let fixture: ComponentFixture<Carriages>;
  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Carriages] }).compileComponents();
    fixture = TestBed.createComponent(Carriages);
  });

  it('shows an icon and the number, labelled', async () => {
    fixture.componentRef.setInput('count', 8);
    await fixture.whenStable();
    expect(element().querySelector('svg')).not.toBeNull();
    expect(element().querySelector('.count')?.textContent).toBe('8');
    expect(element().querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('8 carriages');
  });

  it('shows the value as NS reports it', async () => {
    fixture.componentRef.setInput('count', 4);
    await fixture.whenStable();
    expect(element().querySelector('.count')?.textContent).toBe('4');
  });

  it('is empty when unknown', async () => {
    await fixture.whenStable();
    expect(element().querySelector('svg')).toBeNull();
    expect(element().textContent?.trim()).toBe('');
  });
});
