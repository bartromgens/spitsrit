import { HttpClient } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatCardModule } from '@angular/material/card';
import { RouterLink } from '@angular/router';
import { catchError, of } from 'rxjs';
import { Auth } from '../auth';

interface Health {
  status: string;
  version: string;
  db: string;
}

@Component({
  imports: [MatCardModule, RouterLink],
  selector: 'app-home',
  styleUrl: './home.scss',
  templateUrl: './home.html',
})
export class Home {
  // /healthz is part of gantry's contract, not of the OpenAPI schema.
  protected readonly health = toSignal(
    inject(HttpClient)
      .get<Health>('/healthz')
      .pipe(catchError(() => of(null))),
    { initialValue: undefined },
  );

  protected readonly auth = inject(Auth);
}
