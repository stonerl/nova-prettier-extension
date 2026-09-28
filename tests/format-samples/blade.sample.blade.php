 @extends('layouts.app')

 @section('title', 'Blade Sample')

 @section('content')
     <div class="container">
         <h1>{{ $title }}</h1>

         @if ($user->isAdmin())
             <p>Welcome, admin {{ $user->name }}.</p>
         @elseif ($user->isGuest())
             <p>Please log in.</p>
         @else
             <p>Hello, {{ $user->name }}.</p>
         @endif

         @foreach ($items as $item)
             <li>{{ $item->label }} — {{ $loop->index }}</li>
         @endforeach

         <div data-id="{{ $user->id }}" data-name="{{ $user->name }}">
             {!! $safeHtml !!}
         </div>

         @verbatim
             <div>Raw {{ $template }} content</div>
         @endverbatim

         @include('partials.card', ['item' => $firstItem])

         @component('components.alert')
             @slot('title')
                 Notice
             @endslot
         @endcomponent
     </div>
 @endsection

 @php
     $computed = $items->count() * 2;
 @endphp
