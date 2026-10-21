<script lang="ts">
    import { createEventDispatcher } from 'svelte';
    import HeadingIconButton from './HeadingIconButton.svelte';

    export let expanded: boolean = true;
    export let disabled: boolean = false;
    export let ariaLabelExpanded: string = 'Collapse';
    export let ariaLabelCollapsed: string = 'Expand';

    const dispatch = createEventDispatcher<{ toggle: void }>();

    function handleClick() {
        dispatch('toggle');
    }
</script>

<HeadingIconButton
    className="tree-toggle-button"
    icon={expanded ? 'chevron-down' : 'chevron-right'}
    ariaLabel={expanded ? ariaLabelExpanded : ariaLabelCollapsed}
    {disabled}
    onPress={handleClick}
/>
