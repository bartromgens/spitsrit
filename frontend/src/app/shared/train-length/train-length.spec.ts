import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TrainLength } from './train-length';

describe('TrainLength', () => {
  let fixture: ComponentFixture<TrainLength>;
  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const render = async (length: number | null): Promise<void> => {
    fixture.componentRef.setInput('length', length);
    await fixture.whenStable();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [TrainLength] }).compileComponents();
    fixture = TestBed.createComponent(TrainLength);
  });

  it('shows one car per unit and the count', async () => {
    await render(4);
    expect(element().querySelectorAll('.car')).toHaveLength(4);
    expect(element().textContent).toContain('4 treinstellen');
  });

  it('caps the number of cars drawn but not the count', async () => {
    await render(20);
    expect(element().querySelectorAll('.car')).toHaveLength(12);
    expect(element().textContent).toContain('20 treinstellen');
  });

  it('shows nothing when the length is unknown', async () => {
    await render(null);
    expect(element().textContent?.trim()).toBe('');
  });
});
