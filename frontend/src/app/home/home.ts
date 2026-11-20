import { Component, inject } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { RouterLink } from '@angular/router';
import { Auth } from '../auth';
import { TripPlanner } from '../trip-planner/trip-planner';

@Component({
  imports: [MatCardModule, RouterLink, TripPlanner],
  selector: 'app-home',
  styleUrl: './home.scss',
  templateUrl: './home.html',
})
export class Home {
  protected readonly auth = inject(Auth);
}
