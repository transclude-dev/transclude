<script server>
  import { notes } from '../data/notes.js';

  export default async () => ({ title: 'Notes', notes });
</script>

<title>${title}</title>

# ${title}

There are ${notes.length} of them.
