<script lang="ts">
    import HeadingIconButton from './HeadingIconButton.svelte';

    export let ariaLabel: string = '删除节点';
    export let disabled: boolean = false;
    export let onDelete: (() => unknown | Promise<unknown>) | null = null;

    function handleClick() {
        if (disabled || !onDelete) {
            return;
        }

        void onDelete();
    }
</script>

<HeadingIconButton
    className="heading-delete-button"
    icon="trash-2"
    ariaLabel={ariaLabel}
    disabled={disabled}
    onPress={handleClick}
/>
