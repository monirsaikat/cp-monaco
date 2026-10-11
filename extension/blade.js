// Laravel Blade templates (*.blade.php): syntax highlighting and directive completion.
//
// The highlighting is Monaco's own PHP grammar (HTML with embedded PHP) plus Blade's
// {{ … }}, {!! … !!}, {{-- … --}} and @directives, whose arguments are colored as PHP.
(() => {
  'use strict';

  // Directives that take a block get their closing directive in the snippet.
  const DIRECTIVES = [
    ['if', '@if (${1:condition})\n\t$0\n@endif'],
    ['elseif', '@elseif (${1:condition})'],
    ['else', '@else'],
    ['endif', '@endif'],
    ['unless', '@unless (${1:condition})\n\t$0\n@endunless'],
    ['isset', '@isset(${1:\\$variable})\n\t$0\n@endisset'],
    ['empty', '@empty(${1:\\$variable})\n\t$0\n@endempty'],
    ['foreach', '@foreach (${1:\\$items} as ${2:\\$item})\n\t$0\n@endforeach'],
    ['forelse', '@forelse (${1:\\$items} as ${2:\\$item})\n\t$0\n@empty\n\t\n@endforelse'],
    ['for', '@for (${1:\\$i = 0}; ${2:\\$i < \\$count}; ${3:\\$i++})\n\t$0\n@endfor'],
    ['while', '@while (${1:condition})\n\t$0\n@endwhile'],
    ['switch', '@switch(${1:\\$value})\n\t@case(${2:1})\n\t\t$0\n\t\t@break\n\t@default\n\t\t\n@endswitch'],
    ['case', '@case(${1:value})'],
    ['break', '@break'],
    ['continue', '@continue'],
    ['default', '@default'],
    ['extends', '@extends(\'${1:layouts.app}\')'],
    ['section', '@section(\'${1:content}\')\n\t$0\n@endsection'],
    ['endsection', '@endsection'],
    ['yield', '@yield(\'${1:content}\')'],
    ['parent', '@parent'],
    ['include', '@include(\'${1:view}\')'],
    ['includeIf', '@includeIf(\'${1:view}\')'],
    ['includeWhen', '@includeWhen(${1:condition}, \'${2:view}\')'],
    ['each', '@each(\'${1:view}\', ${2:\\$items}, \'${3:item}\')'],
    ['component', '@component(\'${1:component}\')\n\t$0\n@endcomponent'],
    ['slot', '@slot(\'${1:name}\')\n\t$0\n@endslot'],
    ['props', '@props([${1}])'],
    ['class', '@class([${1}])'],
    ['push', '@push(\'${1:scripts}\')\n\t$0\n@endpush'],
    ['prepend', '@prepend(\'${1:scripts}\')\n\t$0\n@endprepend'],
    ['stack', '@stack(\'${1:scripts}\')'],
    ['once', '@once\n\t$0\n@endonce'],
    ['php', '@php\n\t$0\n@endphp'],
    ['verbatim', '@verbatim\n\t$0\n@endverbatim'],
    ['auth', '@auth\n\t$0\n@endauth'],
    ['guest', '@guest\n\t$0\n@endguest'],
    ['can', '@can(\'${1:ability}\')\n\t$0\n@endcan'],
    ['cannot', '@cannot(\'${1:ability}\')\n\t$0\n@endcannot'],
    ['error', '@error(\'${1:field}\')\n\t$0\n@enderror'],
    ['env', '@env(\'${1:production}\')\n\t$0\n@endenv'],
    ['production', '@production\n\t$0\n@endproduction'],
    ['csrf', '@csrf'],
    ['method', '@method(\'${1|PUT,PATCH,DELETE|}\')'],
    ['json', '@json(${1:\\$data})'],
    ['vite', '@vite([${1:\'resources/css/app.css\', \'resources/js/app.js\'}])'],
    ['lang', '@lang(\'${1:messages.key}\')'],
    ['checked', '@checked(${1:condition})'],
    ['selected', '@selected(${1:condition})'],
    ['disabled', '@disabled(${1:condition})'],
    ['required', '@required(${1:condition})'],
    ['dd', '@dd(${1:\\$variable})'],
    ['dump', '@dump(${1:\\$variable})'],
    ['livewire', '@livewire(\'${1:component}\')'],
    ['livewireStyles', '@livewireStyles'],
    ['livewireScripts', '@livewireScripts'],
  ];

  function grammar(php) {
    const states = php.tokenizer;
    // In a Monarch pattern "@name" inserts an attribute of the grammar, so a literal @ before
    // a letter is written "@@".
    const echo = [/\{\{|\{!!/, 'metatag.blade', '@bladeEcho'];
    return {
      ...php,
      tokenizer: {
        ...states,
        root: [
          [/\{\{--/, 'comment.blade', '@bladeComment'],
          echo,
          // An email address, not a directive.
          [/[\w.+-]+@[\w.-]+/, ''],
          [/@@php\b(?!\s*\()/, 'keyword.blade', '@bladePhp'],
          [/(@[a-zA-Z_]\w*)(\s*)(\()/, ['keyword.blade', '', { token: 'delimiter.parenthesis.php', next: '@bladeArgs' }]],
          [/@[a-zA-Z_]\w*/, 'keyword.blade'],
          // PHP's own rules, with its catch-all for text replaced by ones that stop at { and @.
          ...states.root.slice(0, -1),
          [/[^<{@\w]+/, ''],
          [/\w+/, ''],
          [/[{@]/, ''],
        ],
        otherTag: [echo, ...states.otherTag],
        bladeComment: [
          [/--\}\}/, 'comment.blade', '@pop'],
          [/[^-]+/, 'comment.blade'],
          [/./, 'comment.blade'],
        ],
        bladeEcho: [
          [/\}\}|!!\}/, 'metatag.blade', '@pop'],
          { include: 'phpRoot' },
        ],
        // The arguments of a directive: PHP up to the parenthesis that closes it.
        bladeArgs: [
          [/\(/, 'delimiter.parenthesis.php', '@push'],
          [/\)/, 'delimiter.parenthesis.php', '@pop'],
          { include: 'phpRoot' },
        ],
        bladePhp: [
          [/@@endphp\b/, 'keyword.blade', '@pop'],
          { include: 'phpRoot' },
        ],
      },
    };
  }

  // True when the text ends inside PHP code: an echo, an @php block or a directive's arguments.
  function inCode(text) {
    const echo = Math.max(text.lastIndexOf('{{'), text.lastIndexOf('{!!'));
    if (echo !== -1 && !text.startsWith('{{--', echo) && echo > Math.max(text.lastIndexOf('}}'), text.lastIndexOf('!!}'))) return true;
    const block = text.lastIndexOf('@php');
    if (block !== -1 && block > text.lastIndexOf('@endphp') && !/^@php\s*\(/.test(text.slice(block, block + 40))) return true;
    return /@\w+\s*\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*$/.test(text.slice(text.lastIndexOf('\n') + 1));
  }

  function register(monaco) {
    monaco.languages.register({ id: 'blade', aliases: ['Blade', 'blade'], extensions: ['.blade.php'] });
    require(['vs/basic-languages/php/php'], (php) => {
      monaco.languages.setMonarchTokensProvider('blade', grammar(php.language));
      monaco.languages.setLanguageConfiguration('blade', {
        ...php.conf,
        comments: { blockComment: ['{{--', '--}}'] },
      });
    });

    const Kind = monaco.languages.CompletionItemKind;
    const Rule = monaco.languages.CompletionItemInsertTextRule;
    monaco.languages.registerCompletionItemProvider('blade', {
      triggerCharacters: ['@'],
      provideCompletionItems(model, position) {
        const line = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
        const typed = line.match(/(?:^|[^\w@])(@\w*)$/);
        if (!typed) return { suggestions: [] };
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: position.column - typed[1].length,
          endColumn: position.column,
        };
        return {
          suggestions: DIRECTIVES.map(([name, body]) => ({
            label: `@${name}`,
            kind: Kind.Keyword,
            insertText: body,
            insertTextRules: Rule.InsertAsSnippet,
            detail: 'Blade directive',
            range,
          })),
        };
      },
    });
  }

  window.CPM_BLADE = { register, inCode };
})();
