import { Component, OnInit, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Api } from '../api/api';
import { configRetrieve } from '../api/functions';
import { Auth } from '../auth';

@Component({
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  selector: 'app-login',
  styleUrl: './login.scss',
  templateUrl: './login.html',
})
export class Login implements OnInit {
  private readonly api = inject(Api);
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly form = inject(NonNullableFormBuilder).group({
    email: ['', Validators.required],
    password: ['', Validators.required],
  });
  protected readonly error = signal('');
  protected readonly googleLogin = signal(false);

  async ngOnInit(): Promise<void> {
    if (this.route.snapshot.queryParamMap.get('error') === 'google') {
      this.error.set('Logging in with Google failed. Please try again.');
    }
    try {
      this.googleLogin.set((await this.api.invoke(configRetrieve)).google_login);
    } catch {
      // Without the config the page still works with a username and password.
    }
  }

  protected async submit(): Promise<void> {
    if (this.form.invalid) {
      return;
    }
    const { email, password } = this.form.getRawValue();
    try {
      await this.auth.login(email, password);
    } catch {
      this.error.set('Invalid email or password.');
      return;
    }
    await this.router.navigateByUrl(this.route.snapshot.queryParamMap.get('next') ?? '/commutes');
  }
}
