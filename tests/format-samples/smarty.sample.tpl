<{extends file="base.tpl"}>

<{block name="content"}>
<{if $items}>
<ul>
<{foreach from=$items item=item}>
<li><{$item.name}></li>
<{foreachelse}>
No items.
<{/foreach}>
</ul>
<{/if}>
<{/block}>
