<script lang="ts">
    import HeadingIconButton from './HeadingIconButton.svelte';

    export let ariaLabel: string = '弹框编辑节点内容';
    export let disabled: boolean = false;
    export let onEdit: (() => unknown | Promise<unknown>) | null = null;

    function handleClick() {
        if (disabled || !onEdit) {
            return;
        }

        void onEdit();
    }
</script>

<HeadingIconButton
    className="heading-range-edit-button"
    icon="edit"
    ariaLabel={ariaLabel}
    disabled={disabled}
    onPress={handleClick}
/>
