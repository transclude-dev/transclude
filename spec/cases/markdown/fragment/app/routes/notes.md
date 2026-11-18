<script server>
  export const prerender = false;

  export default async () => ({ notes: ['milk', 'eggs'] });
</script>

# Notes

<ul id="list" fragment>
  <li each="note of notes">${note}</li>
</ul>

That is all.
