<script setup lang="ts">
import { computed } from 'vue'

import Button from '@agent/components/ui/button/Button.vue'

import { DEFAULT_AGENT_PAYWALL_PRESENTATION } from '../../../services/agent/agentPaywallPresentation'
import type {
  AgentPaywallAction,
  AgentPaywallPresentation
} from '../../../services/agent/agentPaywallPresentation'

const { presentation = DEFAULT_AGENT_PAYWALL_PRESENTATION, message } =
  defineProps<{
    presentation?: AgentPaywallPresentation
    message?: string
  }>()
const emit = defineEmits<{
  paywallAction: [action: AgentPaywallAction]
}>()

const bodyKeys: Record<AgentPaywallPresentation['kind'], string> = {
  subscribed: 'agent.paywall.body.subscribed',
  subscriptionRequired: 'agent.paywall.body.subscriptionRequired',
  member: 'agent.paywall.body.member',
  salesManaged: 'agent.paywall.body.salesManaged',
  local: 'agent.paywall.body.local',
  unavailable: 'agent.paywall.body.subscriptionRequired'
}
const bodyKey = computed(() => bodyKeys[presentation.kind])
const showUpgrade = computed(
  () => presentation.kind === 'subscribed' && presentation.showUpgrade
)
const showSubscribe = computed(
  () => presentation.kind === 'subscriptionRequired'
)
const showAddCredits = computed(
  () => presentation.kind === 'subscribed' || presentation.kind === 'local'
)
</script>

<template>
  <div
    role="alert"
    class="ctv:flex ctv:w-full ctv:flex-col ctv:justify-center ctv:gap-2 ctv:overflow-hidden ctv:rounded-lg ctv:border ctv:border-component-node-border ctv:bg-modal-card-background ctv:p-4 ctv:shadow-sm"
  >
    <div class="ctv:flex ctv:w-full ctv:items-start ctv:gap-2">
      <span
        aria-hidden="true"
        class="ctv:mt-0.5 ctv:icon-[lucide--gauge] ctv:size-5 ctv:shrink-0 ctv:text-destructive-background"
      />
      <div class="ctv:min-w-0 ctv:flex-1 ctv:text-sm/5">
        <p class="ctv:m-0 ctv:font-medium ctv:text-base-foreground">
          {{ $t('agent.paywall.title') }}
        </p>
        <p class="ctv:m-0 ctv:text-muted-foreground">
          {{ message || $t(bodyKey) }}
        </p>
      </div>
    </div>

    <div
      v-if="showAddCredits || showSubscribe || showUpgrade"
      class="ctv:flex ctv:w-full ctv:justify-end ctv:gap-2"
    >
      <Button
        v-if="showUpgrade"
        variant="secondary"
        size="sm"
        @click="emit('paywallAction', 'upgrade')"
      >
        {{ $t('agent.paywall.upgradePlan') }}
      </Button>
      <Button
        v-if="showSubscribe"
        variant="inverted"
        size="sm"
        @click="emit('paywallAction', 'subscribe')"
      >
        {{ $t('agent.paywall.subscribe') }}
      </Button>
      <Button
        v-if="showAddCredits"
        variant="inverted"
        size="sm"
        @click="emit('paywallAction', 'addCredits')"
      >
        {{ $t('agent.paywall.addCredits') }}
      </Button>
    </div>
  </div>
</template>
