import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PlatformSign } from './platform-sign';

describe('PlatformSign', () => {
  let fixture: ComponentFixture<PlatformSign>;
  const sign = async (track: string): Promise<string> => {
    fixture.componentRef.setInput('track', track);
    await fixture.whenStable();
    return (fixture.nativeElement as HTMLElement).querySelector('.sign')?.textContent ?? '';
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [PlatformSign] }).compileComponents();
    fixture = TestBed.createComponent(PlatformSign);
  });

  it('shows the platform number', async () => {
    expect(await sign('5a')).toBe('5a');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('platform 5a');
  });

  it('shows a question mark when the platform is unknown', async () => {
    expect(await sign('')).toBe('?');
  });
});
