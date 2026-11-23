import { HttpTestingController } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl } from '@angular/forms';
import { settle, testProviders } from '../../testing';
import { StationAutocomplete } from './station-autocomplete';

@Component({
  imports: [StationAutocomplete],
  template: `<app-station-autocomplete [control]="control" label="From" />`,
})
class Host {
  readonly control = new FormControl('', { nonNullable: true });
}

const pause = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 300));

describe('StationAutocomplete', () => {
  let fixture: ComponentFixture<Host>;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [Host], providers: testProviders });
    fixture = TestBed.createComponent(Host);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  it('labels the field and shows the control text', async () => {
    fixture.componentInstance.control.setValue('Utr');
    await fixture.whenStable();
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('mat-label')?.textContent).toBe('From');
    expect(element.querySelector('input')?.value).toBe('Utr');
  });

  it('searches stations for a typed query after a pause', async () => {
    fixture.componentInstance.control.setValue('Utr');
    http.expectNone('/api/stations/?q=Utr');
    await pause();
    http.expectOne('/api/stations/?q=Utr').flush([{ code: 'UT', name: 'Utrecht Centraal' }]);
    await settle(fixture);
  });

  it('does not search for a query that is too short', async () => {
    fixture.componentInstance.control.setValue('U');
    await pause();
    http.expectNone((req) => req.url === '/api/stations/');
  });
});
