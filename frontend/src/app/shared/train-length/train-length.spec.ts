import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TrainLength } from './train-length';

describe('TrainLength', () => {
  let fixture: ComponentFixture<TrainLength>;
  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const render = async (inputs: Record<string, unknown>): Promise<void> => {
    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }
    await fixture.whenStable();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [TrainLength] }).compileComponents();
    fixture = TestBed.createComponent(TrainLength);
  });

  it('shows a seat icon with the number, labelled, and the train type', async () => {
    await render({ seats: 620, trainType: 'VIRM' });
    const seats = element().querySelector('.seats');
    expect(seats?.getAttribute('aria-label')).toBe('620 seats');
    expect(seats?.querySelector('svg')).not.toBeNull();
    expect(seats?.querySelector('.sp-mono')?.textContent).toBe('620');
    expect(element().querySelector('.type')?.textContent).toBe('VIRM');
    expect(element().textContent).not.toContain('carriages');
  });

  it('shows nothing when the size is unknown', async () => {
    await render({ seats: null, trainType: null });
    expect(element().textContent?.trim()).toBe('');
  });

  it('shows no warning badge unless the train is shorter than usual', async () => {
    await render({ seats: 620, shorterStock: null });
    expect(element().querySelector('.shorter')).toBeNull();
  });

  it('shows a warning badge with the NS warning as its label', async () => {
    await render({ seats: 300, shorterStock: 'BUSY', shorterStockWarning: 'Kortere trein' });
    const badge = element().querySelector('.shorter');
    expect(badge?.getAttribute('title')).toBe('Kortere trein');
    expect(badge?.getAttribute('aria-label')).toBe('Kortere trein');
    expect(badge?.classList).not.toContain('extra-busy');
  });

  it('marks an extra busy shorter train', async () => {
    await render({ seats: 300, shorterStock: 'EXTRA_BUSY' });
    expect(element().querySelector('.shorter.extra-busy')).not.toBeNull();
  });
});
