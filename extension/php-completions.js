// Completions for PHP files. Monaco highlights PHP but has no PHP language service, so this
// offers built-in functions, keywords, superglobals and snippets, plus the variables, functions,
// classes and $this members found in the open file. Outside <?php blocks (the HTML part of a
// template) it offers HTML tags and attributes.
(() => {
  'use strict';

  // name(param, param): parameters become tab stops. A trailing "?" marks an optional one,
  // which is left out of the inserted text.
  const FUNCTIONS = `
    strlen(string) strtolower(string) strtoupper(string) ucfirst(string) ucwords(string) lcfirst(string) trim(string) ltrim(string) rtrim(string)
    str_replace(search,replace,subject) str_ireplace(search,replace,subject) substr(string,offset,length?) strpos(haystack,needle) stripos(haystack,needle)
    strrpos(haystack,needle) strstr(haystack,needle) str_contains(haystack,needle) str_starts_with(haystack,needle) str_ends_with(haystack,needle)
    str_repeat(string,times) str_pad(string,length) str_split(string) str_word_count(string) strrev(string) strcmp(a,b) strcasecmp(a,b) strncmp(a,b,length)
    sprintf(format,values) printf(format,values) number_format(num,decimals?) nl2br(string) htmlspecialchars(string) htmlspecialchars_decode(string)
    html_entity_decode(string) htmlentities(string) strip_tags(string) addslashes(string) stripslashes(string) wordwrap(string,width?) explode(separator,string)
    implode(separator,array) join(separator,array) md5(string) sha1(string) crc32(string) hash(algo,data) password_hash(password,algo) password_verify(password,hash)
    base64_encode(string) base64_decode(string) urlencode(string) urldecode(string) rawurlencode(string) http_build_query(data) uniqid() random_bytes(length) bin2hex(string)
    mb_strlen(string) mb_substr(string,start,length?) mb_strtolower(string) mb_strtoupper(string) mb_strpos(haystack,needle) mb_str_split(string) mb_strimwidth(string,start,width)
    preg_match(pattern,subject,matches?) preg_match_all(pattern,subject,matches?) preg_replace(pattern,replacement,subject) preg_replace_callback(pattern,callback,subject)
    preg_split(pattern,subject) preg_quote(string)
    count(array) in_array(needle,haystack) array_key_exists(key,array) array_keys(array) array_values(array) array_merge(array1,array2) array_combine(keys,values)
    array_map(callback,array) array_filter(array,callback?) array_reduce(array,callback,initial?) array_walk(array,callback) array_slice(array,offset,length?)
    array_splice(array,offset,length?) array_push(array,values) array_pop(array) array_shift(array) array_unshift(array,values) array_unique(array) array_reverse(array)
    array_search(needle,haystack) array_sum(array) array_product(array) array_column(array,column) array_chunk(array,size) array_fill(start,count,value)
    array_flip(array) array_diff(array1,array2) array_intersect(array1,array2) array_key_first(array) array_key_last(array) array_is_list(array) range(start,end)
    compact(names) extract(array) sort(array) rsort(array) usort(array,callback) uasort(array,callback) uksort(array,callback) ksort(array) krsort(array) asort(array) arsort(array)
    shuffle(array) array_rand(array) min(values) max(values) current(array) reset(array) end(array) next(array) key(array)
    isset(var) empty(var) is_null(value) is_array(value) is_string(value) is_int(value) is_numeric(value) is_bool(value) is_float(value) is_object(value) is_callable(value)
    intval(value) floatval(value) strval(value) boolval(value) settype(var,type) gettype(value) get_class(object) get_object_vars(object) method_exists(object,method)
    property_exists(object,property) class_exists(class) function_exists(function) call_user_func(callback,args) call_user_func_array(callback,args) func_get_args()
    abs(num) ceil(num) floor(num) round(num,precision?) sqrt(num) pow(base,exp) intdiv(a,b) fmod(a,b) rand(min,max) mt_rand(min,max) random_int(min,max) pi() number_format(num)
    json_encode(value,flags?) json_decode(json,associative?) serialize(value) unserialize(data) var_dump(value) print_r(value,return?) var_export(value,return?)
    file_get_contents(filename) file_put_contents(filename,data) file_exists(filename) is_file(filename) is_dir(filename) is_readable(filename) is_writable(filename)
    mkdir(directory,permissions?,recursive?) rmdir(directory) unlink(filename) rename(from,to) copy(from,to) fopen(filename,mode) fclose(stream) fgets(stream) fwrite(stream,data)
    fread(stream,length) file(filename) glob(pattern) scandir(directory) basename(path) dirname(path) pathinfo(path) realpath(path) tempnam(directory,prefix) filesize(filename)
    filemtime(filename) move_uploaded_file(from,to) readfile(filename)
    date(format,timestamp?) time() mktime(hour,minute,second,month,day,year) strtotime(datetime) checkdate(month,day,year) date_default_timezone_set(timezone) microtime(as_float?)
    usleep(microseconds) sleep(seconds) header(header) http_response_code(code?) setcookie(name,value) session_start() session_destroy() session_regenerate_id()
    define(name,value) defined(name) constant(name) die(message) exit() error_log(message) trigger_error(message) set_error_handler(callback) set_exception_handler(callback)
    error_reporting(level) ini_set(option,value) ini_get(option) phpinfo() php_sapi_name() phpversion() memory_get_usage() spl_autoload_register(callback)
    filter_var(value,filter) filter_input(type,name) curl_init(url) curl_setopt(handle,option,value) curl_exec(handle) curl_close(handle) mail(to,subject,message)
    password_needs_rehash(hash,algo) array_map_keys(array) iterator_to_array(iterator) array_walk_recursive(array,callback) array_merge_recursive(array1,array2)
    array_replace(array,replacements) array_pad(array,length,value) array_flip(array) str_word_count(string) similar_text(a,b) levenshtein(a,b) soundex(string) metaphone(string)
  `.trim().split(/\s+/);

  const KEYWORDS = (
    'abstract and array as break callable case catch class clone const continue declare default do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile ' +
    'enum extends final finally fn for foreach function global goto if implements include include_once instanceof insteadof interface isset list match namespace new null or ' +
    'print private protected public readonly require require_once return static switch throw trait true false try unset use var while xor yield self parent'
  ).split(' ');

  const SUPERGLOBALS = ['$_GET', '$_POST', '$_REQUEST', '$_SERVER', '$_SESSION', '$_COOKIE', '$_FILES', '$_ENV', '$GLOBALS', '$this'];

  const SNIPPETS = [
    ['if', 'if (${1:condition}) {\n\t$0\n}'],
    ['ifelse', 'if (${1:condition}) {\n\t$2\n} else {\n\t$0\n}'],
    ['elseif', 'elseif (${1:condition}) {\n\t$0\n}'],
    ['foreach', 'foreach (${1:\\$items} as ${2:\\$item}) {\n\t$0\n}'],
    ['foreachk', 'foreach (${1:\\$items} as ${2:\\$key} => ${3:\\$value}) {\n\t$0\n}'],
    ['for', 'for (${1:\\$i} = 0; ${1:\\$i} < ${2:\\$count}; ${1:\\$i}++) {\n\t$0\n}'],
    ['while', 'while (${1:condition}) {\n\t$0\n}'],
    ['switch', 'switch (${1:\\$value}) {\n\tcase ${2:value}:\n\t\t$0\n\t\tbreak;\n\tdefault:\n\t\tbreak;\n}'],
    ['match', 'match (${1:\\$value}) {\n\t${2:value} => ${3:result},\n\tdefault => ${0:null},\n}'],
    ['function', 'function ${1:name}(${2}) {\n\t$0\n}'],
    ['fn', 'fn(${1:\\$x}) => ${0:\\$x}'],
    ['class', 'class ${1:Name}\n{\n\t$0\n}'],
    ['interface', 'interface ${1:Name}\n{\n\t$0\n}'],
    ['trait', 'trait ${1:Name}\n{\n\t$0\n}'],
    ['try', 'try {\n\t$1\n} catch (${2:\\Exception} ${3:\\$e}) {\n\t$0\n}'],
    ['pubf', 'public function ${1:name}(${2})\n{\n\t$0\n}'],
    ['prif', 'private function ${1:name}(${2})\n{\n\t$0\n}'],
    ['prof', 'protected function ${1:name}(${2})\n{\n\t$0\n}'],
    ['pubsf', 'public static function ${1:name}(${2})\n{\n\t$0\n}'],
    ['construct', 'public function __construct(${1})\n{\n\t$0\n}'],
    ['php', '<?php $0 ?>'],
    ['echo', 'echo ${0};'],
    ['pre', 'echo \'<pre>\';\nprint_r(${1:\\$var});\necho \'</pre>\';'],
    ['vd', 'var_dump(${1:\\$var});\n${0}'],
    ['dd', 'var_dump(${1:\\$var});\ndie;'],
    ['isset', 'isset(${1:\\$var})'],
    ['ternary', '${1:condition} ? ${2:a} : ${3:b}'],
    ['require', 'require_once ${1:\'file.php\'};'],
    ['json', 'header(\'Content-Type: application/json\');\necho json_encode(${1:\\$data});'],
  ];

  const HTML_TAGS = (
    'a abbr address article aside audio b blockquote body br button canvas caption code col colgroup dd details div dl dt em fieldset figcaption figure footer form ' +
    'h1 h2 h3 h4 h5 h6 head header hr html i iframe img input label legend li link main meta nav noscript ol optgroup option p picture pre script section select small source ' +
    'span strong style sub summary sup table tbody td template textarea tfoot th thead time title tr ul video'
  ).split(' ');
  const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'link', 'meta', 'source', 'col']);
  const HTML_ATTRIBUTES = (
    'class id style href src alt title name value type placeholder action method target rel for data- aria-label role width height disabled checked selected readonly required ' +
    'onclick content charset lang colspan rowspan tabindex'
  ).split(' ');

  // True when the cursor is inside a <?php … ?> block (or an unfinished one).
  function inPhp(text) {
    const open = Math.max(text.lastIndexOf('<?php'), text.lastIndexOf('<?='), text.lastIndexOf('<?\n'));
    return open !== -1 && open > text.lastIndexOf('?>');
  }

  function unique(matches) {
    return [...new Set(matches)];
  }

  function signature(spec) {
    const [, name, params] = spec.match(/^([\w]+)\((.*)\)$/);
    const list = params ? params.split(',') : [];
    return { name, required: list.filter((p) => !p.endsWith('?')), all: list.map((p) => p.replace('?', '')) };
  }

  const MEMBERS = window.CPM_PHP_MEMBERS;

  function register(monaco) {
    MEMBERS.init(monaco);
    const Kind = monaco.languages.CompletionItemKind;
    const Rule = monaco.languages.CompletionItemInsertTextRule;
    const functions = FUNCTIONS.map(signature);
    const phpDefaults = { insertTextRules: Rule.InsertAsSnippet };

    monaco.languages.registerCompletionItemProvider('php', {
      triggerCharacters: ['$', '>', ':', '<', ' ', '"', '\'', '-'],
      provideCompletionItems(model, position) {
        const before = model.getValueInRange({ startLineNumber: 1, startColumn: 1, endLineNumber: position.lineNumber, endColumn: position.column });
        const word = model.getWordUntilPosition(position);
        const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn };
        const line = model.getLineContent(position.lineNumber).slice(0, position.column - 1);

        if (!inPhp(before)) return { suggestions: htmlSuggestions(monaco, model, position, line, range) };

        const all = model.getValue();
        const suggestions = [];

        // Members after ->, ?-> or ::, resolved through the project index where possible.
        const members = MEMBERS.member(model, position, line);
        if (members) return { suggestions: members };

        // use App\Models\Us… (an import at the top of the file)
        const imports = MEMBERS.importSuggestions(line, position, range);
        if (imports) return { suggestions: imports };

        // Variables: $name, plus superglobals.
        const varStart = line.match(/\$\w*$/);
        if (varStart) {
          const varRange = { ...range, startColumn: position.column - varStart[0].length };
          for (const name of SUPERGLOBALS) suggestions.push({ label: name, kind: Kind.Variable, insertText: name, range: varRange, sortText: `2${name}` });
          for (const name of unique(all.match(/\$[A-Za-z_]\w*/g) || [])) {
            if (!SUPERGLOBALS.includes(name)) suggestions.push({ label: name, kind: Kind.Variable, insertText: name, range: varRange, sortText: `0${name}` });
          }
          return { suggestions };
        }

        if (!word.word && !/\w$/.test(line)) return { suggestions };

        // After new, extends, implements, instanceof or catch ( only a class makes sense.
        if (/\b(?:new|extends|implements|instanceof)\s+[\\\w]*$/.test(line) || /\bcatch\s*\(\s*(?:[\\\w]+\s*\|\s*)*[\\\w]*$/.test(line)) {
          for (const m of all.matchAll(/\b(?:class|interface|trait|enum)\s+(\w+)/g)) {
            suggestions.push({ label: m[1], kind: Kind.Class, insertText: m[1], range, sortText: `0${m[1]}` });
          }
          suggestions.push(...MEMBERS.classSuggestions(model, range));
          return { suggestions };
        }

        const docs = window.CPM_PHP_DOCS;
        if (docs && docs.ready()) {
          for (const fn of docs.functions()) {
            const args = fn.required.map((p, i) => `\${${i + 1}:\\$${p}}`).join(', ');
            suggestions.push({
              label: { label: fn.name, description: `(${fn.sig.length > 56 ? `${fn.sig.slice(0, 53)}...` : fn.sig})` },
              kind: Kind.Function,
              insertText: `${fn.name}(${args})`,
              detail: fn.ret,
              range,
              sortText: `3${fn.name}`,
              _doc: ['f', fn.name],
              ...phpDefaults,
            });
          }
          // Constants such as E_ALL, PHP_EOL and JSON_PRETTY_PRINT.
          if (/^[A-Z_]/.test(word.word)) {
            for (const [name, value] of docs.constantEntries()) {
              suggestions.push({ label: name, kind: Kind.Constant, insertText: name, detail: value, range, sortText: `5${name}` });
            }
          }
        } else {
          for (const fn of functions) {
            const args = fn.required.map((p, i) => `\${${i + 1}:\\$${p}}`).join(', ');
            suggestions.push({
              label: { label: fn.name, description: `(${fn.all.join(', ')})` },
              kind: Kind.Function,
              insertText: `${fn.name}(${args})`,
              range,
              sortText: `3${fn.name}`,
              ...phpDefaults,
            });
          }
        }
        suggestions.push(...MEMBERS.classSuggestions(model, range));
        for (const label of KEYWORDS) suggestions.push({ label, kind: Kind.Keyword, insertText: label, range, sortText: `4${label}` });
        for (const [label, body] of SNIPPETS) {
          suggestions.push({
            label,
            kind: Kind.Snippet,
            insertText: body,
            documentation: { value: `\`\`\`php\n${body.replace(/\$\{\d+:([^}]*)\}|\$\d/g, (_, d) => d || '').replace(/\\\$/g, '$')}\n\`\`\`` },
            range,
            sortText: `1${label}`,
            ...phpDefaults,
          });
        }
        // Names declared in this file.
        for (const m of all.matchAll(/\b(?:class|interface|trait|enum)\s+(\w+)/g)) {
          suggestions.push({ label: m[1], kind: Kind.Class, insertText: m[1], range, sortText: `0${m[1]}` });
        }
        for (const name of unique([...all.matchAll(/\bfunction\s+(\w+)\s*\(/g)].map((m) => m[1]))) {
          suggestions.push({ label: name, kind: Kind.Function, insertText: `${name}($0)`, range, sortText: `0${name}`, ...phpDefaults });
        }
        for (const name of unique([...all.matchAll(/\bconst\s+(\w+)\s*=/g)].map((m) => m[1]))) {
          suggestions.push({ label: name, kind: Kind.Constant, insertText: name, range, sortText: `0${name}` });
        }
        return { suggestions };
      },
      // Fills in the documentation panel for the highlighted suggestion only.
      resolveCompletionItem: (item) => MEMBERS.resolveItem(item),
    });

    monaco.languages.registerHoverProvider('php', {
      provideHover: (model, position) => MEMBERS.hover(model, position),
    });

    monaco.languages.registerSignatureHelpProvider('php', {
      signatureHelpTriggerCharacters: ['(', ','],
      signatureHelpRetriggerCharacters: [','],
      provideSignatureHelp: (model, position) => MEMBERS.signatureHelp(model, position),
    });
  }

  function htmlSuggestions(monaco, model, position, line, range) {
    const Kind = monaco.languages.CompletionItemKind;
    const Rule = monaco.languages.CompletionItemInsertTextRule;
    const suggestions = [];

    // Closing tag for the nearest unclosed one.
    if (/<\/\w*$/.test(line)) {
      const text = model.getValueInRange({ startLineNumber: 1, startColumn: 1, endLineNumber: position.lineNumber, endColumn: position.column });
      const stack = [];
      for (const m of text.replace(/<\?[\s\S]*?(\?>|$)/g, '').matchAll(/<(\/?)([a-zA-Z][\w-]*)[^>]*?(\/?)>/g)) {
        const [, closing, name, selfClosing] = m;
        if (selfClosing || VOID_TAGS.has(name.toLowerCase())) continue;
        if (closing) {
          const at = stack.lastIndexOf(name);
          if (at !== -1) stack.length = at;
        } else {
          stack.push(name);
        }
      }
      if (stack.length) {
        const name = stack[stack.length - 1];
        suggestions.push({ label: `/${name}`, kind: Kind.Property, insertText: `${name}>`, range, sortText: '0' });
      }
      return suggestions;
    }

    // Inside an opening tag: attributes.
    if (/<[a-zA-Z][^<>]*\s\w*$/.test(line) && !/["'][^"']*$/.test(line.replace(/="[^"]*"|='[^']*'/g, ''))) {
      for (const name of HTML_ATTRIBUTES) {
        suggestions.push({
          label: name,
          kind: Kind.Property,
          insertText: name.endsWith('-') ? name : `${name}="$1"`,
          insertTextRules: Rule.InsertAsSnippet,
          range,
        });
      }
      return suggestions;
    }

    // After "<": tags.
    if (/<\w*$/.test(line)) {
      for (const name of HTML_TAGS) {
        suggestions.push({
          label: name,
          kind: Kind.Property,
          insertText: VOID_TAGS.has(name) ? `${name} $0>` : `${name}>$0</${name}>`,
          insertTextRules: Rule.InsertAsSnippet,
          range,
        });
      }
    }
    return suggestions;
  }

  window.CPM_PHP = { register };
})();
