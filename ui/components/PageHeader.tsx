import React from "react";
import { Flex } from "@dynatrace/strato-components/layouts";
import { Heading, Text } from "@dynatrace/strato-components/typography";
import Colors from "@dynatrace/strato-design-tokens/colors";

interface PageHeaderProps {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}

export const PageHeader: React.FC<PageHeaderProps> = ({ title, subtitle, actions }) => (
  <Flex justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap={12}>
    <Flex flexDirection="column" gap={4}>
      <Heading level={2} style={{ margin: 0 }}>{title}</Heading>
      {subtitle && (
        <Text textStyle="small" style={{ color: Colors.Text.Neutral.Subdued }}>
          {subtitle}
        </Text>
      )}
    </Flex>
    {actions}
  </Flex>
);
