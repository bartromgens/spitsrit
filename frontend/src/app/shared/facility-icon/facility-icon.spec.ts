import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FacilityIcon } from './facility-icon';

describe('FacilityIcon', () => {
  let fixture: ComponentFixture<FacilityIcon>;
  let element: HTMLElement;

  async function render(code: string): Promise<void> {
    fixture.componentRef.setInput('code', code);
    await fixture.whenStable();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [FacilityIcon] });
    fixture = TestBed.createComponent(FacilityIcon);
    element = fixture.nativeElement as HTMLElement;
  });

  it.each([
    ['WIFI', 'Wi-Fi'],
    ['TOILET', 'Toilet'],
    ['STILTE', 'Quiet zone'],
    ['FIETS', 'Bicycles'],
    ['STROOM', 'Power sockets'],
    ['TOEGANKELIJK', 'Step-free'],
  ])('shows %s as an icon named %s', async (code, label) => {
    await render(code);
    expect(element.querySelector('svg path')?.getAttribute('d')).toBeTruthy();
    expect(element.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(element.querySelector('.sr-only')?.textContent).toBe(label);
    expect(element.getAttribute('title')).toBe(label);
  });

  it('shows an unknown code as text', async () => {
    await render('NEW_THING');
    expect(element.querySelector('svg')).toBeNull();
    expect(element.textContent?.trim()).toBe('new_thing');
    expect(element.getAttribute('title')).toBe('new_thing');
  });
});
