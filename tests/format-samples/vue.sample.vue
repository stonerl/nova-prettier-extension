<template>
  <div id="app" class="main">
    <h1>{{ title }}</h1>

    <input
      v-model="inputText"
      type="text"
      :placeholder="placeholder"
      @input="handleInput"
    />

    <button :disabled="isDisabled" @click="submit">Submit</button>

    <ul>
      <li v-for="(item, index) in items" :key="index">
        {{ index + 1 }}. {{ item }}
      </li>
    </ul>

    <component-a v-if="showComponent" />
    <component-b v-else />

    <slot name="footer" />
  </div>
</template>

<script lang="ts">
import { defineComponent, ref } from 'vue'

export default defineComponent({
  name: 'App',

  props: {
    title: {
      type: String,
      required: true,
    },
    placeholder: {
      type: String,
      default: 'Enter text',
    },
  },

  setup(props, { emit }) {
    const inputText = ref('')
    const isDisabled = ref(false)
    const items = ref<string[]>(['Item 1', 'Item 2'])
    const showComponent = ref(true)

    function handleInput(event: Event) {
      const target = event.target as HTMLInputElement
      inputText.value = target.value
    }

    function submit() {
      if (inputText.value.trim()) {
        emit('submit', inputText.value)
        inputText.value = ''
      } else {
        isDisabled.value = true
      }
    }

    return {
      inputText,
      isDisabled,
      items,
      showComponent,
      handleInput,
      submit,
    }
  },
})
</script>

<style lang="scss" scoped>
#app {
  padding: 2rem;
  background: #f9f9f9;

  h1 {
    font-size: 1.5rem;
    margin-bottom: 1rem;
  }

  input {
    padding: 0.5rem;
    margin-bottom: 1rem;
    border: 1px solid #ccc;
  }

  button {
    padding: 0.5rem 1rem;
    background-color: blue;
    color: white;
    border: none;
    cursor: pointer;

    &:disabled {
      background-color: gray;
      cursor: not-allowed;
    }
  }

  ul {
    list-style-type: none;
    padding-left: 0;

    li {
      padding: 0.25rem 0;
    }
  }
}
</style>
